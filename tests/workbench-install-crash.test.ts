import { spawn } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { WorkbenchStore } from '../src/workbench-store.js'
import { WorkbenchRepairStore } from '../src/workbench-repair-store.js'

it.each(['install:after-intent', 'install:after-dispatch', 'install:after-identity'])(
  'SIGKILL at %s keeps the artifact and installation unknown without replay', async point => {
    const top = await realpath(await mkdtemp(join(tmpdir(), 'repair-install-sigkill-')))
    const child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/repair-install-crash-worker.ts', top, point],
      { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      let output = '', errors = ''
      child.stderr!.on('data', chunk => { errors += String(chunk) })
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`No ${point} cutpoint: ${errors}`)), 60_000)
        child.stdout!.on('data', chunk => {
          output += String(chunk)
          if (output.includes(`CUTPOINT ${point}\n`)) { clearTimeout(timeout); resolve() }
        })
        child.once('exit', (code, signal) => {
          if (!output.includes(`CUTPOINT ${point}\n`)) {
            clearTimeout(timeout); reject(new Error(`Worker exited ${code}/${signal}: ${errors}`))
          }
        })
      })
      const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
      child.kill('SIGKILL'); await exited
      const store = new WorkbenchStore(join(top, 'runs'))
      try {
        const repairs = new WorkbenchRepairStore(store)
        const blocked = await repairs.recoverInterrupted()
        expect(blocked).toHaveLength(1)
        const record = await repairs.get(blocked[0]!)
        expect(record).toMatchObject({ phase: 'blocked', outcome: 'inconclusive', reason: 'repair-unknown-mutation' })
        expect((await repairs.installIntent(record.id))).toMatchObject({ status: 'unknown' })
        const artifact = await repairs.buildArtifact(record.id)
        expect(artifact?.artifactDigest).toMatch(/^[a-f0-9]{64}$/)
        expect((await repairs.verifications(record.id)).at(-1)).toMatchObject({ grade: 'software', outcome: 'software-verified' })
        expect(await repairs.recoverInterrupted()).toEqual([])
      } finally { await store.close() }
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await rm(top, { recursive: true, force: true })
    }
  }, 120_000)
