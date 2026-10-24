import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { sha256 } from '../src/content-hash.js'
import { MOBILE_MIRROR_TOOL_NAMES } from '../src/tool-contracts.js'

it('keeps frozen legacy authoring inputs, HTTP, tool schemas and result fixtures unchanged', async () => {
  const baseline = JSON.parse(await readFile(new URL('./fixtures/workbench-authoring-contract-baseline.json', import.meta.url), 'utf8')) as {
    baseline: string; files: Record<string, string>; tools: string[]
  }
  const integration = JSON.parse(await readFile(new URL('./fixtures/workbench-authoring-dev-integration-baseline.json', import.meta.url), 'utf8')) as {
    dev: string; addedTools: string[]; updatedFiles: Record<string, string>
  }
  expect([...MOBILE_MIRROR_TOOL_NAMES].slice(0, baseline.tools.length)).toEqual(baseline.tools)
  expect([...MOBILE_MIRROR_TOOL_NAMES].slice(baseline.tools.length)).toEqual(integration.addedTools)
  expect(Object.keys(integration.updatedFiles).every(path => path in baseline.files)).toBe(true)
  const runtime = JSON.parse(await readFile(new URL('./fixtures/workbench-runtime-contract-integration-baseline.json', import.meta.url), 'utf8')) as { updatedFiles: Record<string, string> }
  // A reviewed, single-file v2 extension; never blanket-refresh the legacy baseline.
  expect(Object.keys(runtime.updatedFiles)).toEqual(['src/workbench-contracts.ts'])
  const repair = JSON.parse(await readFile(new URL('./fixtures/workbench-repair-dev-integration-baseline.json', import.meta.url), 'utf8')) as { updatedFiles: Record<string, string> }
  // Repair adds separate opt-in tools and CLI commands; the default tool names and result goldens stay frozen.
  expect(Object.keys(repair.updatedFiles)).toEqual([
    'src/workbench-cli.ts', 'src/mobile-mirror-commands.ts', 'tests/workbench-cli.test.ts',
    'tests/mcp-server.test.ts', 'src/tool-contracts.ts',
  ])
  const harness = JSON.parse(await readFile(new URL('./fixtures/dsh-020-contract-integration-baseline.json', import.meta.url), 'utf8')) as { updatedFiles: Record<string, string> }
  // Host compatibility changes only this probe; retain all legacy core hashes.
  expect(Object.keys(harness.updatedFiles)).toEqual(['scripts/dsh-clean-profile-probe.mjs'])
  const playback = JSON.parse(await readFile(new URL('./fixtures/report-playback-contract-integration-baseline.json', import.meta.url), 'utf8')) as { updatedFiles: Record<string, string> }
  // Only the auxiliary capture count/geometry assertion changes; do not refresh legacy API or fixture hashes.
  expect(Object.keys(playback.updatedFiles)).toEqual(['tests/workbench.test.ts'])
  const web = JSON.parse(await readFile(new URL('./fixtures/web-selfhost-contract-integration-baseline.json', import.meta.url), 'utf8')) as { updatedFiles: Record<string, string> }
  // ADR 0028 adds an opt-in discriminated Web run and capability field only.
  expect(Object.keys(web.updatedFiles)).toEqual(['src/viewer-workbench-runs-http.ts'])
  const privacy = JSON.parse(await readFile(new URL('./fixtures/privacy-contract-integration-baseline.json', import.meta.url), 'utf8')) as { updatedFiles: Record<string, string> }
  // Only the redacted archive and its renamed test reference change; all runtime schemas stay frozen.
  expect(Object.keys(privacy.updatedFiles)).toEqual([
    'tests/workbench.test.ts',
    'tests/fixtures/workbench-runs/sampleapp-ios-history-title-missing.mobile-mirror-run.json',
  ])
  // Reviewed branding changes only; keep all protocol and evidence hashes frozen.
  const branding = JSON.parse(await readFile(new URL('./fixtures/flowassert-branding-contract-baseline.json', import.meta.url), 'utf8')) as { updatedFiles: Record<string, string> }
  expect(Object.keys(branding.updatedFiles)).toEqual(['tests/mcp-stdio.test.ts', 'scripts/dsh-clean-profile-probe.mjs'])
  for (const [path, digest] of Object.entries(baseline.files)) {
    const expected = branding.updatedFiles[path] ?? privacy.updatedFiles[path] ?? web.updatedFiles[path] ?? playback.updatedFiles[path] ?? harness.updatedFiles[path] ?? repair.updatedFiles[path] ?? runtime.updatedFiles[path] ?? integration.updatedFiles[path] ?? digest
    expect(sha256(await readFile(new URL(`../${path}`, import.meta.url))), path).toBe(expected)
  }
})
