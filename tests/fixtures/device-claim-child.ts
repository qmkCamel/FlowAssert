import { DeviceOwnerClaim } from '../../src/device-owner-claim.js'

const [root, mode] = process.argv.slice(2)
if (!root || !mode) process.exit(2)
try {
  const lease = await new DeviceOwnerClaim({ root }).acquire('android', 'physical-device')
  if (mode === 'try') { process.stdout.write('ACQUIRED\n'); await lease.release(); process.exit(0) }
  await lease.markActive(); process.stdout.write('READY\n')
  process.stdin.once('data', async () => { await lease.release(); process.exit(0) })
} catch (error) {
  process.stdout.write(`CONFLICT:${error instanceof Error ? error.name : 'unknown'}\n`)
  process.exit(3)
}
