import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const exec = promisify(execFile)
const serial = process.env.MOBILE_MIRROR_ANDROID_SERIAL
if (!serial) throw new Error('Explicit MOBILE_MIRROR_ANDROID_SERIAL required')
const adb = process.env.MOBILE_MIRROR_ADB_EXECUTABLE ?? 'adb'
const label = process.env.MIRROR_LINK_LABEL ?? 'current-usb'
const root = resolve('artifacts/physical-validation', `android-link-${new Date().toISOString().replaceAll(':', '-')}`)
await mkdir(root, { recursive: true, mode: 0o700 })
const samples: unknown[] = []
for (let round = 1; round <= 10; round++) {
  for (const args of [['get-state'], ['shell', 'echo', 'mirror-ready'], ['shell', 'getprop', 'ro.build.version.sdk']]) {
    const started = Date.now()
    let result: Record<string, unknown>
    try {
      const { stdout } = await exec(adb, ['-s', serial, ...args], { timeout: 5000, maxBuffer: 8192 })
      result = { ok: true, value: stdout.trim() }
    } catch (error) {
      const failure = error as { killed?: boolean; code?: string | number }
      result = { ok: false, timeout: failure.killed === true, code: failure.code }
    }
    const sample = { round, command: args.join(' '), ms: Date.now() - started, ...result }
    samples.push(sample); console.log(JSON.stringify(sample))
    await writeFile(resolve(root, 'report.json'), JSON.stringify({ label, root, scope: 'read-only-adb-without-appium', samples }, null, 2))
  }
  await new Promise(resolve => setTimeout(resolve, 1000))
}
console.log(JSON.stringify({ root }))
