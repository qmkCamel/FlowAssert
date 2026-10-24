import { probeAndroidHealth, probeIosHealth } from './workbench-health-probe.js'

export async function runHealthProbeCli(args: readonly string[], io: { stdout: { write(value: string): unknown }; stderr: { write(value: string): unknown } }): Promise<number> {
  const options: Record<string, string> = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1]
    if (!key || !value || !['--platform', '--adb', '--device', '--app'].includes(key) || Object.hasOwn(options, key)) throw new Error('health-probe-options-invalid')
    options[key] = value
  }
  const controller = new AbortController(), cancel = () => controller.abort(new Error('Cancelled'))
  process.once('SIGINT', cancel)
  try {
    const report = options['--platform'] === 'ios' && Object.keys(options).length === 1 ? probeIosHealth()
      : options['--platform'] === 'android' && options['--device'] && options['--app']
        ? await probeAndroidHealth({ adbPath: options['--adb'] ?? 'adb', deviceId: options['--device'], appId: options['--app'] }, controller.signal)
        : undefined
    if (!report) throw new Error('health-probe-target-required')
    io.stdout.write(JSON.stringify(report, null, 2) + '\n')
    return 2 // No currently approved source; never equate a successful read probe with health.
  } finally { process.removeListener('SIGINT', cancel) }
}
