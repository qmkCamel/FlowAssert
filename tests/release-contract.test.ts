import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const root = new URL('../', import.meta.url)

describe('alpha prerelease contract', () => {
  it('keeps the package private and publishes the onboarding surfaces', async () => {
    const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8')) as {
      version: string
      private: boolean
      bin: Record<string, string>
      exports: Record<string, unknown>
      files: string[]
    }
    expect(manifest).toMatchObject({ version: '0.1.0-alpha.2', private: true })
    expect(manifest.bin).toMatchObject({
      'flowassert': './scripts/mobile-mirror-cli.mjs',
      'flowassert-mcp': './scripts/mobile-mirror-mcp.mjs',
      'flowassert-viewer': './scripts/mobile-mirror-viewer.mjs',
    })
    expect(manifest.exports).toHaveProperty('./onboarding')
    expect(manifest.exports).toHaveProperty('./host-runtime')
    expect(manifest.exports).toHaveProperty('./viewer')
    expect(manifest.files).toEqual(expect.arrayContaining([
      'docs/beta-installation.md',
      'docs/releases/0.1.0-alpha.1.md',
      'docs/releases/0.1.0-alpha.2.md',
      'docs/decisions/0004-guided-beta-and-managed-appium.md',
      'docs/decisions/0005-semantic-agent-actions.md',
      'docs/local-viewer.md',
    ]))
    expect(manifest.files).not.toEqual(expect.arrayContaining([
      'public-readiness.config.json',
      'docs/open-source-readiness.md',
      'examples/',
      '.github/',
    ]))
  })

  it('runs every gate before one prerelease creation and never publishes npm', async () => {
    const workflow = await readFile(new URL('.github/workflows/release.yml', root), 'utf8')
    expect(workflow).toContain('- v0.1.0-alpha.2')
    expect(workflow).not.toContain('- v0.1.0-alpha.1')
    expect(workflow).toContain('contents: write')
    expect(workflow).toContain('node-version: 24.19.0')
    expect(workflow).toContain('pnpm@11.7.0')
    expect(workflow).toContain('pnpm install --frozen-lockfile')
    expect(workflow).toContain('pnpm public:check')
    expect(workflow).not.toContain('npm publish')
    const releaseIndex = workflow.indexOf('gh release create')
    expect(releaseIndex).toBeGreaterThan(0)
    for (const gate of [
      'pnpm check',
      'pnpm test:e2e',
      'pnpm build',
      'validate --all --strict',
      'prepare-release.mjs',
      'release-candidate-probe.mjs',
      'managed-appium-smoke.mjs',
      'dsh-clean-profile-probe.mjs',
    ]) {
      expect(workflow.indexOf(gate), gate).toBeGreaterThan(0)
      expect(workflow.indexOf(gate), gate).toBeLessThan(releaseIndex)
    }
    expect(workflow.match(/gh release create/g)).toHaveLength(1)
    expect(workflow).toContain('flowassert-0.1.0-alpha.2.tgz')
    expect(workflow).toContain('flowassert-0.1.0-alpha.2.sha256')
    expect(workflow).toContain('docs/releases/0.1.0-alpha.2.md')
    expect(workflow).toContain('Probe DeepSeek Harness 0.2.0-rc.2 clean profile')
    expect(workflow).not.toContain('@deepseek-ai/dsh@0.1.0-rc.8')
    expect(workflow).toContain('install-dsh-probe-runtime.mjs')
  })

  it('keeps public governance checks outside the runtime package surface', async () => {
    const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8')) as {
      scripts: Record<string, string>
      files: string[]
    }
    const ci = await readFile(new URL('.github/workflows/ci.yml', root), 'utf8')
    expect(manifest.scripts['public:check']).toBe('node scripts/check-public-readiness.mjs')
    expect(manifest.files.some((file) => file.startsWith('.github/'))).toBe(false)
    expect(manifest.files.filter(file => file.startsWith('examples/')).sort()).toEqual([
      'cleanup.mjs', 'order.yaml.example', 'prepare.mjs', 'project.json.example', 'verify.mjs', 'verify-only-once.mjs',
    ].map(name => `examples/business-http/${name}`).concat([
      'persistence.yaml.example', 'two-submit.yaml.example', 'project.json.example',
    ].map(name => `examples/runtime/${name}`)).sort())
    expect(ci).toContain('fetch-depth: 0')
    expect(ci).toContain('pnpm public:check')
  })

  it('decodes repository URLs before using them as filesystem paths', async () => {
    for (const script of ['release-candidate-probe.mjs', 'dsh-clean-profile-probe.mjs']) {
      const source = await readFile(new URL(`scripts/${script}`, root), 'utf8')
      expect(source).toContain('fileURLToPath')
      expect(source).not.toMatch(/new URL\([^\n]+\)\.pathname/)
    }
  })

  it('pins the complete DSH prerelease family for the clean release probe', async () => {
    const source = await readFile(new URL('scripts/install-dsh-probe-runtime.mjs', root), 'utf8')
    expect(source).toContain("const VERSION = '0.2.0-rc.2'")
    expect(source).toContain("name.startsWith('@deepseek-ai/dsh-')")
    expect(source).toContain('Mixed DSH prerelease family detected')
  })
})
