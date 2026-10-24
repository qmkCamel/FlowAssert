import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { probeIosDiagnosticSource } from '../src/ios-health-source-probe.js'

const capsPath = process.env.MOBILE_MIRROR_CAPABILITIES_PATH ?? ''
const xcrunPath = process.env.MOBILE_MIRROR_XCRUN_PATH ?? ''
if (!isAbsolute(capsPath) || !isAbsolute(xcrunPath)) throw new Error('Explicit private capabilities and absolute Xcode xcrun required')
const caps = JSON.parse(await readFile(capsPath, 'utf8')) as Record<string, unknown>
if (String(caps.platformName).toLowerCase() !== 'ios' || typeof caps['appium:udid'] !== 'string') throw new Error('Explicit physical iPhone required')
const root = resolve('artifacts/physical-validation', `ios-health-source-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await mkdir(root, { recursive: true, mode: 0o700 })
const report = await probeIosDiagnosticSource({ xcrunPath, deviceId: caps['appium:udid'], privateRoot: root }, AbortSignal.timeout(30000))
await writeFile(resolve(root, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
// No raw logs, file names, device IDs, paths or process metadata in the public summary.
process.stdout.write(JSON.stringify({ ...report, rawEvidenceRetainedPrivately: true }) + '\n')
if (!report.facts.liveDiagnosticSourceChecked) process.exitCode = 1
