import { runOnboardingCli } from '../../src/onboarding-cli.js'

const [suiteId, configPath, connectionPath, reportDir] = process.argv.slice(2)
if (!suiteId || !configPath || !connectionPath || !reportDir) throw new Error('Missing managed job fixture arguments')
process.stdout.write('READY\n')
process.exitCode = await runOnboardingCli(['test', 'job', suiteId, '--config', configPath, '--connection', connectionPath, '--report-dir', reportDir, '--startup-timeout-ms', '5000', '--timeout-ms', '15000', '--shutdown-timeout-ms', '5000'])
