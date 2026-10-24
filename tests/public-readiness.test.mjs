import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkPublicSurface,
  checkReviewedMedia,
  checkMarkdownLinks,
  checkRepository,
  formatFinding,
  isNoreplyEmail,
  isForbiddenLocalPath,
  scanText,
} from '../scripts/check-public-readiness.mjs'

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe('public readiness checks', () => {
  it('detects secret-shaped content without flagging documented placeholders', () => {
    const privateKey = ['-----BEGIN ', 'PRIVATE KEY-----'].join('')
    const githubToken = ['ghp_', 'A'.repeat(40)].join('')
    const gitlabToken = ['glpat-', 'B'.repeat(30)].join('')
    const homePath = ['/', 'Users', '/private-user/project'].join('')

    expect(scanText(`${privateKey}\n${githubToken}\n${homePath}`, 'src/leak.txt')).toEqual(expect.arrayContaining([
      'private-key-header',
      'github-token',
      'absolute-home-path',
    ]))
    expect(scanText('api_key = "EXAMPLE_API_KEY"\nappium:udid = "DEVICE_UDID"', 'examples/config.txt')).toEqual([])
    expect(scanText(gitlabToken, 'config.txt')).toContain('gitlab-token')
  })

  it('rejects environment variants and binary signing material without relying on credential text', () => {
    for (const name of ['.env', 'config/.env.production', 'flowassert.signing.json', 'signing/cert.p12', 'app.keystore']) {
      expect(isForbiddenLocalPath(name), name).toBe(true)
    }
    expect(isForbiddenLocalPath('.env.example')).toBe(false)
    expect(isForbiddenLocalPath('examples/config.json.example')).toBe(false)
  })

  it('checks local links with query parameters without treating the query as a filename', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mirror-query-link-'))
    temporaryDirectories.push(directory)
    await writeFile(path.join(directory, 'README.md'), '[demo](demo.html?case=mock#start)\n[missing](missing.html?case=mock)\n')
    await writeFile(path.join(directory, 'demo.html'), '<main id="start">Mock</main>')
    const findings = await checkMarkdownLinks(directory, ['README.md'])
    expect(findings).toHaveLength(1)
    expect(findings[0].path).toBe('README.md')
  })

  it('formats findings without source lines or candidate values', () => {
    const rendered = formatFinding({
      checkId: 'github-token',
      path: 'fixtures/leak.txt',
      commit: '0123456789abcdef0123456789abcdef01234567',
    })
    expect(rendered).toBe('FAIL github-token path=fixtures/leak.txt commit=0123456789ab')
    expect(rendered).not.toContain('ghp_')
    expect(rendered).not.toContain('\n')
  })

  it('requires noreply identities', () => {
    expect(isNoreplyEmail('123+maintainer@users.noreply.github.com')).toBe(true)
    expect(isNoreplyEmail('maintainer@example.com')).toBe(false)
  })

  it('does not exempt old identities or skip logs and extensionless examples', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mirror-history-privacy-'))
    temporaryDirectories.push(directory)
    const git = (...args) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' }).toString().trim()
    git('init')
    await writeFile(path.join(directory, 'proof.log'), ['/', 'Users', '/private-user/run'].join(''))
    await writeFile(path.join(directory, 'config.yaml.example'), ['com.', 'kw', 'ai', '.private'].join(''))
    await writeFile(path.join(directory, '.env.production'), 'SHORT_VALUE=demo')
    await writeFile(path.join(directory, 'signing.p12'), Buffer.from([0, 1, 2]))
    git('add', '.')
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture')
    await writeFile(path.join(directory, 'public-readiness.config.json'), JSON.stringify({ legacyHistoryBoundary: git('rev-parse', 'HEAD') }))
    const result = await checkRepository(directory)
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ checkId: 'non-noreply-history-email' }),
      expect.objectContaining({ checkId: 'forbidden-local-config', path: '.env.production' }),
      expect.objectContaining({ checkId: 'forbidden-local-config-history', path: 'signing.p12' }),
      expect.objectContaining({ checkId: 'absolute-home-path', path: 'proof.log' }),
      expect.objectContaining({ checkId: 'company-specific-content', path: 'config.yaml.example' }),
    ]))
  })

  it('reports missing governance and bilingual public-entry markers', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mobile-mirror-public-surface-'))
    temporaryDirectories.push(directory)
    await writeFile(path.join(directory, 'README.md'), '# Incomplete\n')
    await writeFile(path.join(directory, 'README.zh-CN.md'), '# 不完整\n')

    const findings = await checkPublicSurface(directory, ['README.md', 'README.zh-CN.md'], {
      distribution: {
        sourceLicense: 'MIT',
        packageChannel: 'github-release',
        packagePrivate: true,
        npmPublished: false,
      },
      screenshots: {},
    })
    expect(findings.some(({ checkId }) => checkId === 'missing-community-file')).toBe(true)
    expect(findings.some(({ checkId }) => checkId === 'missing-public-entry-marker')).toBe(true)
  })

  it('requires a new media review for added or changed bytes and rejects stale approvals', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'flowassert-media-review-'))
    temporaryDirectories.push(directory)
    await writeFile(path.join(directory, 'demo.png'), 'reviewed fixture bytes')
    await writeFile(path.join(directory, 'public-media-review.json'), JSON.stringify({ files: [{
      path: 'demo.png', sha256: createHash('sha256').update('reviewed fixture bytes').digest('hex'),
      review: ['original-image-review'], retention: 'test fixture',
    }] }))
    expect(await checkReviewedMedia(directory, ['demo.png'])).toEqual([])
    await writeFile(path.join(directory, 'demo.png'), 'replacement bytes')
    expect(await checkReviewedMedia(directory, ['demo.png', 'new.MOV'])).toEqual(expect.arrayContaining([
      { checkId: 'media-review-content-changed', path: 'demo.png' },
      { checkId: 'media-review-required', path: 'new.MOV' },
    ]))
    expect(await checkReviewedMedia(directory, [])).toEqual([{ checkId: 'media-review-stale-entry', path: 'demo.png' }])
  })

  it('passes against the current repository surfaces and reachable history', async () => {
    const result = await checkRepository(fileURLToPath(new URL('../', import.meta.url)))
    expect(result.findings).toEqual([])
    expect(result.fileCount).toBeGreaterThan(0)
    expect(result.commitCount).toBeGreaterThan(0)
  }, 90_000) // Full Git-history/filesystem integration scan is slower under the parallel suite; keep the scan comprehensive.
})
