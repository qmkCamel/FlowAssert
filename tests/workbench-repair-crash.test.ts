import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { WorkbenchStore } from '../src/workbench-store.js'
import { WorkbenchRepairStore } from '../src/workbench-repair-store.js'

const points = [
  'reset:before-intent', 'reset:after-intent', 'reset:after-dispatch', 'reset:after-receipt',
  'child:after-create', 'child:after-reference', 'child:after-exit',
] as const

it.each(points)('SIGKILL at %s never resumes a Mock repair side effect', async point => {
  const root = await mkdtemp(join(tmpdir(), 'repair-sigkill-'))
  let child: ReturnType<typeof spawn> | undefined
  try {
    child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/repair-crash-worker.ts', root, point],
      { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', errorOutput = ''
    child.stderr!.on('data', chunk => { errorOutput += String(chunk) })
    const reached = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`No ${point} cutpoint: ${errorOutput}`)), 30_000)
      child!.stdout!.on('data', chunk => {
        output += String(chunk)
        if (output.includes(`CUTPOINT ${point}\n`)) { clearTimeout(timeout); resolve() }
      })
      child!.once('exit', (code, signal) => {
        if (!output.includes(`CUTPOINT ${point}\n`)) { clearTimeout(timeout); reject(new Error(`Worker exited ${code}/${signal}: ${errorOutput}`)) }
      })
    })
    await reached
    const exited = new Promise<void>(resolve => child!.once('exit', () => resolve()))
    child.kill('SIGKILL')
    await exited
    const store = new WorkbenchStore(root)
    try {
      const repairs = new WorkbenchRepairStore(store)
      const blocked = await repairs.recoverInterrupted()
      expect(blocked).toHaveLength(1)
      const record = await repairs.get(blocked[0]!)
      expect(record).toMatchObject({ phase: 'blocked', outcome: 'inconclusive', reason: 'repair-unknown-mutation',
        generation: 1 })
      const attempt = (await repairs.attempts(record.id))[0]
      expect(attempt).toMatchObject({ generation: 1 })
      expect(attempt?.finishedAt).toBeUndefined()
      expect((await store.readOnlySnapshot(record.sourceSnapshot.runId)).run.verdict).toBe('fail')
      const resets = await repairs.resets(record.id)
      if (point === 'reset:before-intent') expect(resets).toHaveLength(0)
      if (point === 'reset:after-intent' || point === 'reset:after-dispatch') expect(resets[0]).toMatchObject({ status: 'prepared' })
      if (['reset:after-receipt', 'child:after-create', 'child:after-reference', 'child:after-exit'].includes(point))
        expect(resets[0]).toMatchObject({ status: 'completed' })
      expect(await repairs.recoverInterrupted()).toEqual([])
    } finally { await store.close() }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await rm(root, { recursive: true, force: true })
  }
}, 120_000)
