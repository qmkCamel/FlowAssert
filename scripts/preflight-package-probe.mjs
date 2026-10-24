#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

const exec = promisify(execFile), tarball = process.argv[2]
if (!tarball || !isAbsolute(tarball) || process.argv.length !== 3) throw new Error('Usage: preflight-package-probe <absolute-tarball>')
const root = await mkdtemp(join(tmpdir(), 'preflight-package-'))
try {
  await exec('npm', ['install', '--ignore-scripts', '--legacy-peer-deps', '--omit=dev', '--prefix', root, tarball], { timeout: 120_000, maxBuffer: 1_048_576 })
  const cli = join(root, 'node_modules/flowassert/scripts/mobile-mirror-cli.mjs')
  const results = []
  for (const entry of ['viewer', 'mcp', 'dsh', 'cli']) {
    const execution = await exec(process.execPath, [cli, 'doctor', '--target', entry, '--format', 'json'], {
      cwd: root, env: { ...process.env, PATH: '/preflight-no-host-tools' }, timeout: 30_000, maxBuffer: 1_048_576,
    }).then(result => ({ ...result, code: 0 }), error => ({ stdout: error.stdout, code: error.code }))
    const report = JSON.parse(execution.stdout)
    if (report.schemaVersion !== 2 || report.context.entry !== entry || report.checks.some(check => /appium|android|ios|scrcpy/.test(check.id))) throw new Error('Installed scope isolation failed')
    if (entry === 'dsh' ? execution.code !== 2 || report.overall !== 'incomplete' : execution.code !== 0 || report.overall !== 'ready' || report.checks.some(check => check.id.startsWith('dsh'))) throw new Error('Installed entry result mismatch')
    results.push({ entry, overall: report.overall, exitCode: execution.code })
  }
  for (const operation of ['report', 'mock']) {
    const { stdout } = await exec(process.execPath, [cli, 'doctor', '--operation', operation, '--format', 'json'], { cwd: root, env: { ...process.env, PATH: '/preflight-no-host-tools' }, timeout: 30_000 })
    if (JSON.parse(stdout).overall !== 'ready') throw new Error('Installed no-device path failed')
  }
  const wrong = await exec(process.execPath, [cli, 'doctor', '--target', 'dsh', '--dsh-executable', process.execPath, '--format', 'json'], { cwd: root, timeout: 30_000 })
    .then(() => { throw new Error('Unexpected DSH acceptance') }, error => error)
  if (wrong.code !== 2 || !JSON.parse(wrong.stdout).checks.some(check => check.code === 'dsh_version_mismatch')) throw new Error('Installed wrong-host rejection failed')
  process.stdout.write(`${JSON.stringify({ tarballSha256: createHash('sha256').update(await readFile(tarball)).digest('hex'), entries: results, noPhoneTools: true, wrongDsh: 'rejected', realDeviceAcceptance: false })}\n`)
} finally { await rm(root, { recursive: true, force: true }) }
