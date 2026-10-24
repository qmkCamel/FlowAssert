import { readFile } from 'node:fs/promises'
import { dshVersionContractErrors } from './dsh-version-contract.js'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as Record<string, unknown>
const packageScripts = manifest.scripts as Record<string, string> | undefined
if (packageScripts?.['public:check'] !== 'node scripts/check-public-readiness.mjs') {
  throw new Error('package.json must expose the deterministic public:check command')
}
const lockfile = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
const validation = await readFile(new URL('../docs/validation.md', import.meta.url), 'utf8')
const runtimeProbe = await readFile(new URL('./dsh-runtime-probe.mjs', import.meta.url), 'utf8')
const cleanProfileProbe = await readFile(new URL('./dsh-clean-profile-probe.mjs', import.meta.url), 'utf8')
const dshVersionErrors = dshVersionContractErrors({
  manifest,
  lockfile,
  readme,
  validation,
  runtimeProbe,
  cleanProfileProbe,
})
if (dshVersionErrors.length > 0) throw new Error(dshVersionErrors.join('\n'))
const versionSource = await readFile(new URL('../src/version.ts', import.meta.url), 'utf8')
if (!versionSource.includes(`'${String(manifest.version)}'`)) throw new Error('src/version.ts must match package.json version')
const dsh = manifest.dsh as { bundle?: { patch?: string } } | undefined
if (dsh?.bundle?.patch !== './cordis.patch.yml') {
  throw new Error('package.json must declare dsh.bundle.patch as ./cordis.patch.yml')
}

const dependencies = manifest.dependencies as Record<string, string> | undefined
if (dependencies?.['@modelcontextprotocol/sdk'] !== '1.30.0') {
  throw new Error('package.json must pin @modelcontextprotocol/sdk to 1.30.0')
}
const exportsMap = manifest.exports as Record<string, unknown> | undefined
if (!exportsMap?.['./mcp']) throw new Error('package.json must publish the ./mcp export')
if (!exportsMap?.['./onboarding']) throw new Error('package.json must publish the ./onboarding export')
if (!exportsMap?.['./host-runtime']) throw new Error('package.json must publish the ./host-runtime export')
if (!exportsMap?.['./viewer']) throw new Error('package.json must publish the ./viewer export')
const bin = manifest.bin as Record<string, string> | undefined
if (bin?.['flowassert-mcp'] !== './scripts/mobile-mirror-mcp.mjs') {
  throw new Error('package.json must publish flowassert-mcp')
}
if (bin?.['flowassert'] !== './scripts/mobile-mirror-cli.mjs') {
  throw new Error('package.json must publish flowassert')
}
if (bin?.['flowassert-viewer'] !== './scripts/mobile-mirror-viewer.mjs') {
  throw new Error('package.json must publish flowassert-viewer')
}

const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
for (const fragment of [
  'id: mobile-mirror',
  'name: flowassert',
  'defaultProvider: mock',
  'agentScreenContentPolicy: mock-only',
  'agentTextInputPolicy: mock-only',
  'agentAppControlPolicy: disabled',
  'agentAllowedAppIds: []',
  'appiumRuntimeMode: external',
  "appiumExecutablePath: ''",
  'appiumSessionStartupTimeoutMs: 120000',
  'viewerMediaMode: auto',
  "androidScrcpyPath: ''",
  'iosMjpegFramerate: 15',
  'androidIgnoreHiddenApiPolicyError: true',
  "iosWdaXcodeOrgId: ''",
  'iosWdaAllowProvisioningDeviceRegistration: false',
  'allowHostSigningDiagnostics: false',
]) {
  if (!patch.includes(fragment)) throw new Error(`cordis.patch.yml is missing: ${fragment}`)
}

const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
for (const fragment of ["export const name = 'mobile-mirror'", "export const inject = ['tools', 'attachments']", 'ctx.effect']) {
  if (!source.includes(fragment)) throw new Error(`Plugin entry is missing: ${fragment}`)
}

const tools = await readFile(new URL('../src/tools.ts', import.meta.url), 'utf8')
for (const tool of ['mobile_mirror_ios_preflight', 'mobile_mirror_snapshot', 'mobile_mirror_inspect_screen']) {
  if (!tools.includes(`'${tool}'`)) throw new Error(`Plugin tools are missing ${tool}`)
}

const contracts = await readFile(new URL('../src/tool-contracts.ts', import.meta.url), 'utf8')
for (const tool of [
  'mobile_mirror_list_devices',
  'mobile_mirror_ios_preflight',
  'mobile_mirror_start',
  'mobile_mirror_status',
  'mobile_mirror_snapshot',
  'mobile_mirror_inspect_screen',
  'mobile_mirror_action',
  'mobile_mirror_manage_app',
  'mobile_mirror_stop',
  'mobile_mirror_query_screen',
  'mobile_mirror_test_catalog',
  'mobile_mirror_run_start',
  'mobile_mirror_run_status',
  'mobile_mirror_run_cancel',
  'mobile_mirror_run_evidence',
]) {
  if (!contracts.includes(`'${tool}'`)) throw new Error(`Shared tool contracts are missing ${tool}`)
}

const mcpSource = await readFile(new URL('../src/mcp-server.ts', import.meta.url), 'utf8')
for (const fragment of ['StdioServerTransport', 'Codex']) {
  if (mcpSource.includes(fragment)) throw new Error(`Host-neutral MCP server must not contain ${fragment}`)
}

const files = manifest.files as string[] | undefined
for (const guard of ['scripts/appium-loopback-guard.mjs', 'scripts/appium-loopback-patch.mjs']) {
  if (!files?.includes(guard)) throw new Error(`package.json must publish ${guard}`)
}
for (const file of ['docs/android-real-device.md', 'docs/ios-real-device.md', 'docs/mcp-hosts.md', 'docs/technical-guide.md', 'docs/technical-guide.zh-CN.md', 'docs/local-viewer.md', 'docs/architecture.md', 'docs/product-shape.md', 'docs/milestones.md', 'docs/agent-test-run-control.md', 'docs/decisions/0003-low-latency-viewer-media.md', 'docs/decisions/0004-guided-beta-and-managed-appium.md', 'docs/decisions/0005-semantic-agent-actions.md', 'docs/security.md', 'docs/validation.md', 'docs/beta-installation.md', 'docs/releases/0.1.0-alpha.1.md', 'docs/releases/0.1.0-alpha.2.md', 'scripts/mobile-mirror-mcp.mjs', 'scripts/mobile-mirror-cli.mjs', 'scripts/mobile-mirror-viewer.mjs']) {
  if (!files?.includes(file)) throw new Error(`package.json must publish ${file}`)
}

for (const repositoryOnly of ['public-readiness.config.json', 'docs/open-source-readiness.md']) {
  if (files?.includes(repositoryOnly)) throw new Error(`package.json must keep ${repositoryOnly} out of the runtime tarball`)
}
const runtimeTemplates = new Set([...['prepare.mjs', 'verify.mjs', 'cleanup.mjs', 'project.json.example', 'order.yaml.example', 'verify-only-once.mjs'].map(name => `examples/business-http/${name}`),
  ...['persistence.yaml.example', 'two-submit.yaml.example', 'project.json.example'].map(name => `examples/runtime/${name}`)])
if (files?.some((file) => file.startsWith('.github/') || file.startsWith('examples/') && !runtimeTemplates.has(file))) {
  throw new Error('package.json must keep governance/local examples out of the runtime tarball except the explicitly allowlisted templates')
}

for (const communityFile of [
  '../CONTRIBUTING.md',
  '../CODE_OF_CONDUCT.md',
  '../SUPPORT.md',
  '../.github/SECURITY.md',
  '../.github/CODEOWNERS',
  '../.github/dependabot.yml',
  '../.github/PULL_REQUEST_TEMPLATE.md',
  '../.github/ISSUE_TEMPLATE/config.yml',
  '../.github/ISSUE_TEMPLATE/bug.yml',
  '../.github/ISSUE_TEMPLATE/setup.yml',
  '../.github/ISSUE_TEMPLATE/feature.yml',
  '../docs/open-source-readiness.md',
  '../public-readiness.config.json',
]) {
  const content = await readFile(new URL(communityFile, import.meta.url), 'utf8')
  if (content.trim().length === 0) throw new Error(`${communityFile} must not be empty`)
}

const ciWorkflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const releaseWorkflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
for (const [name, workflow] of [['CI', ciWorkflow], ['release', releaseWorkflow]] as const) {
  if (!workflow.includes('pnpm public:check')) throw new Error(`${name} workflow must run public:check`)
}
if (releaseWorkflow.includes('npm publish')) throw new Error('release workflow must not publish npm')

for (const forbidden of ['scrcpy', 'scrcpy-server', '.mp4', '.h264', '.mjpeg']) {
  if (files?.some((file) => file === forbidden || file.startsWith(`${forbidden}/`))) {
    throw new Error(`package.json must not publish media runtime artifact: ${forbidden}`)
  }
}

for (const domainFile of [
  'workbench-native-execution.ts', 'workbench-run-hooks.ts', 'workbench-suite-facts.ts',
  'workbench-storage-admission.ts', 'workbench-run-finalization.ts', 'workbench-step-evidence.ts',
  'workbench-evidence-contracts.ts', 'workbench-repair-contracts.ts', 'workbench-repair-project.ts', 'workbench-repair-store.ts',
  'workbench-tap-facts.ts', 'workbench-recorded-tap.ts', 'workbench-repair-evidence.ts', 'workbench-repair-diff.ts',
  'workbench-repair-admission.ts', 'workbench-repair-freeze.ts', 'workbench-repair-verification.ts',
  'workbench-repair-private-candidate.ts', 'workbench-repair-run-receipts.ts', 'workbench-repair-workflow.ts',
  'workbench-repair-host-contracts.ts', 'workbench-repair-source.ts', 'workbench-repair-command-runner.ts',
  'workbench-repair-workspaces.ts',
]) {
  const content = await readFile(new URL(`../src/${domainFile}`, import.meta.url), 'utf8')
  for (const importLine of content.match(/^import\s+.*$/gm) ?? []) {
    if (/from\s+['"](?:\.\/)?(?:viewer-|index(?:\.js)?|mcp|tools|workbench-service)/.test(importLine)
      || /from\s+['"](?:cordis|@modelcontextprotocol)/.test(importLine))
      throw new Error(`${domainFile} must not import an entry adapter or Viewer transport`)
  }
}

process.stdout.write('DeepSeek Harness bundle contract: OK\n')
