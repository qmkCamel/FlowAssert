import { expect, it } from 'vitest'
import { inspectIosDiagnosticJson, iosDiagnosticArguments, summarizeIosDiagnosticProbe } from '../src/ios-health-source-probe.js'

it('validates the live Xcode envelope rather than a made-up top-level outcome', () => {
  expect(inspectIosDiagnosticJson({ info: { outcome: 'success', commandType: 'devicectl.device.info.details' }, result: { deviceProperties: {} } }, 'details').status).toBe('readable')
  expect(inspectIosDiagnosticJson({ info: { outcome: 'success', commandType: 'devicectl.device.info.files' }, result: { domain: 'systemCrashLogs', files: [] } }, 'crash-archive').status).toBe('readable')
  expect(inspectIosDiagnosticJson({ outcome: 'success', result: {} }, 'details').status).toBe('invalid')
})
it.each([
  null, [], { info: { outcome: 'success', commandType: 'another-command' }, result: {} },
  { info: { outcome: 'success', commandType: 'devicectl.device.info.files' }, result: { domain: 'appDataContainer', files: [] } },
  { info: { outcome: 'success', commandType: 'devicectl.device.info.files' }, result: { domain: 'systemCrashLogs', files: {} } },
  { info: { outcome: 'failed', commandType: 'devicectl.device.info.files' }, result: { domain: 'systemCrashLogs', files: [] } },
])('rejects invalid, failed or unrelated diagnostics %#', value => {
  expect(inspectIosDiagnosticJson(value, 'crash-archive').status).toBe('invalid')
})

it('uses explicit, fixed, read-only scoped diagnostic arguments', () => {
  const args = iosDiagnosticArguments('device-123', 'crash-archive', '/private/probe/crash.json')
  expect(args).toEqual(['devicectl', 'device', 'info', 'files', '--domain-type', 'systemCrashLogs', '--no-recurse',
    '--filter', "Name BEGINSWITH 'RuntimeFixture'", '--device', 'device-123', '--timeout', '10', '--quiet', '--json-output', '/private/probe/crash.json'])
  expect(args).not.toContain('copy'); expect(args).not.toContain('diagnose')
})
it.each(['', 'device;rm', '../device', 'device with spaces'])('refuses an unsafe device identity %j', id => {
  expect(() => iosDiagnosticArguments(id, 'details', '/private/probe/details.json')).toThrow('ios-diagnostic-target-invalid')
})
it('requires a local absolute output', () => {
  expect(() => iosDiagnosticArguments('device-123', 'details', 'details.json')).toThrow()
})
it('live archive readability does not imply healthy or supported crash/hang signals', () => {
  const result = summarizeIosDiagnosticProbe({ status: 'readable' }, { status: 'readable' })
  expect(result.facts).toMatchObject({ liveDiagnosticSourceChecked: true, scopedCrashArchiveReadable: true, healthSignalsReleased: false, hangSourceVerified: false })
  expect(result.capability.signals).toMatchObject({ crash: { supported: false }, hang: { supported: false } })
  expect(result.capability.signals.crash?.reason).toBe('archive-without-window-completeness')
  expect(result.missing).toContain('end-cursor-drain-acknowledgement')
  expect(JSON.stringify(result)).not.toMatch(/device-123|RuntimeFixture|\/private\//)
})
it('records a live source access failure separately from absent device access', () => {
  expect(summarizeIosDiagnosticProbe({ status: 'readable' }, { status: 'unavailable', reason: 'health-probe-command-failed' }).facts.liveDiagnosticSourceChecked).toBe(true)
  expect(summarizeIosDiagnosticProbe({ status: 'unavailable' }, { status: 'unavailable' }).facts.liveDiagnosticSourceChecked).toBe(false)
  expect(summarizeIosDiagnosticProbe({ status: 'readable' }, { status: 'invalid' }).facts.liveDiagnosticSourceChecked).toBe(false)
})
