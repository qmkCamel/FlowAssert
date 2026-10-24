#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const DEFAULT_ROOT = fileURLToPath(new URL('../', import.meta.url))
const MAX_GIT_OUTPUT_BYTES = 1024 * 1024

const REQUIRED_FILES = [
  'README.md',
  'README.zh-CN.md',
  'docs/technical-guide.md',
  'docs/technical-guide.zh-CN.md',
  'LICENSE',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SUPPORT.md',
  '.github/SECURITY.md',
  '.github/CODEOWNERS',
  '.github/dependabot.yml',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/ISSUE_TEMPLATE/bug.yml',
  '.github/ISSUE_TEMPLATE/setup.yml',
  '.github/ISSUE_TEMPLATE/feature.yml',
  'docs/open-source-readiness.md',
  'public-readiness.config.json',
  'public-media-review.json',
]

const FORBIDDEN_LOCAL_FILES = new Set([
  '.env',
  'mobile-mirror.local.json',
  'mobile-mirror.viewer.json',
  'mobile-mirror.mcp.json',
  'mobile-mirror.dsh.patch.yml',
  'mobile-mirror.host-report.json',
  'mobile-mirror.capabilities.json',
  'mobile-mirror.device.json',
  'mobile-mirror.signing.json',
  'mobile-mirror.provisioning.json',
])

// Filename admission still applies when a value is short, encoded or binary.
export function isForbiddenLocalPath(filePath) {
  const base = path.posix.basename(normalizeGitPath(filePath))
  return FORBIDDEN_LOCAL_FILES.has(base.replace(/^flowassert\./, 'mobile-mirror.'))
    || (base.startsWith('.env.') && base !== '.env.example')
    || /\.(?:p12|pfx|jks|keystore|mobileprovision)$/i.test(base)
}

// Git blob identity of a removed image containing private environment details.
const FORBIDDEN_BLOBS = new Set(['7c2c27419b88a30b108c6b7f8ea854476da74a3b'])

const HOME_PATH_FIXTURES = new Set([
  'tests/ios-wda-preflight.test.ts',
  'tests/mcp-config.test.ts',
  'tests/tools.test.ts',
  'tests/viewer-media-coordinator.test.ts',
  'tests/viewer-server.test.ts',
  'tests/wda-errors.test.ts',
])

const SENSITIVE_PATTERNS = [
  { checkId: 'private-key-header', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { checkId: 'github-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/ },
  { checkId: 'gitlab-token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { checkId: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{30,}\b/ },
  { checkId: 'provider-token', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { checkId: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    checkId: 'credential-assignment',
    pattern: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password)\b\s*[:=]\s*["'][A-Za-z0-9+/=_-]{24,}["']/i,
  },
  { checkId: 'absolute-home-path', pattern: /\/(?:Users|home)\/[A-Za-z0-9._-]+\// },
  { checkId: 'company-specific-content', pattern: /\b(?:kuai[s]hou|kw[a]i)\b|快[手]|com\.(?:kw[a]i|smile)\.|merchant[_]ai[_]container|chatbot[-]half[-]|chat[-]input[-]skill[-]/i },
]

const HISTORY_GREP_PATTERNS = [
  { checkId: 'private-key-header', pattern: '-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----' },
  { checkId: 'github-token', pattern: '(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})' },
  { checkId: 'gitlab-token', pattern: 'glpat-[A-Za-z0-9_-]{20,}' },
  { checkId: 'npm-token', pattern: 'npm_[A-Za-z0-9]{30,}' },
  { checkId: 'provider-token', pattern: 'sk-[A-Za-z0-9_-]{20,}' },
  { checkId: 'aws-access-key', pattern: 'AKIA[0-9A-Z]{16}' },
  {
    checkId: 'credential-assignment',
    pattern: '(api[_-]?key|access[_-]?token|auth[_-]?token|password)[[:space:]]*[:=][[:space:]]*["\x27][A-Za-z0-9+/=_-]{24,}["\x27]',
  },
  { checkId: 'absolute-home-path', pattern: '/(Users|home)/[A-Za-z0-9._-]+/' },
  { checkId: 'company-specific-content', pattern: '(^|[^[:alnum:]_])(kuai[s]hou|Kw[a]i|Kuai[s]hou|kw[a]i)([^[:alnum:]_]|$)|快[手]|com[.](kw[a]i|smile)[.]|merchant[_]ai[_]container|chatbot[-]half[-]|chat[-]input[-]skill[-]' },
]

function normalizeGitPath(value) {
  return value.split(path.sep).join('/')
}

function isAllowedFixture(checkId, filePath) {
  return checkId === 'absolute-home-path' && HOME_PATH_FIXTURES.has(normalizeGitPath(filePath))
}

export function scanText(text, filePath) {
  const checkIds = []
  for (const { checkId, pattern } of SENSITIVE_PATTERNS) {
    if (!isAllowedFixture(checkId, filePath) && pattern.test(text)) checkIds.push(checkId)
  }
  return checkIds
}

export function isNoreplyEmail(email) {
  // GitHub-signed web-flow commits (including Dependabot) use this public
  // service address; personal github.com mailboxes remain disallowed.
  return /@users\.noreply\.github\.com$/i.test(email.trim()) || /^noreply@github\.com$/i.test(email.trim())
}

function safeIdentifier(value) {
  return String(value).replace(/[^A-Za-z0-9._/@:+-]/g, '?').slice(0, 240)
}

export function formatFinding(finding) {
  const parts = [`FAIL ${safeIdentifier(finding.checkId)}`]
  if (finding.path) parts.push(`path=${safeIdentifier(finding.path)}`)
  if (finding.commit) parts.push(`commit=${safeIdentifier(finding.commit.slice(0, 12))}`)
  return parts.join(' ')
}

async function runGit(root, args, { allowExitCodes = [] } = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: root,
      encoding: 'buffer',
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      shell: false,
      windowsHide: true,
    })
    return Buffer.from(stdout)
  } catch (error) {
    if (error && typeof error === 'object' && allowExitCodes.includes(error.code)) {
      return Buffer.from(error.stdout ?? '')
    }
    throw new Error(`git command failed: ${safeIdentifier(args[0] ?? 'unknown')}`)
  }
}

function splitNull(buffer) {
  return buffer.toString('utf8').split('\0').filter(Boolean)
}

async function readUtf8IfPresent(root, filePath) {
  try {
    const bytes = await readFile(path.join(root, filePath))
    return bytes.includes(0) ? null : bytes.toString('utf8')
  } catch {
    return null
  }
}

async function collectCurrentPaths(root) {
  const output = await runGit(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  return [...new Set(splitNull(output).map(normalizeGitPath))].sort()
}

async function collectPublishedCommits(root) {
  const output = await runGit(root, ['rev-list', 'HEAD', '--remotes=origin', '--tags'])
  return [...new Set(output.toString('utf8').split(/\r?\n/).filter(Boolean))]
}

function finding(checkId, filePath, commit) {
  return {
    checkId,
    ...(filePath ? { path: normalizeGitPath(filePath) } : {}),
    ...(commit ? { commit } : {}),
  }
}

async function scanCurrentFiles(root, paths) {
  const findings = []
  for (const filePath of paths) {
    if (isForbiddenLocalPath(filePath)) {
      findings.push(finding('forbidden-local-config', filePath))
    }
    const bytes = await readFile(path.join(root, filePath))
    const blobId = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
    if (FORBIDDEN_BLOBS.has(blobId)) findings.push(finding('private-image', filePath))
    const text = await readUtf8IfPresent(root, filePath)
    if (text === null) continue
    for (const checkId of scanText(text, filePath)) findings.push(finding(checkId, filePath))
  }
  return findings
}

async function scanHistory(root, commits) {
  const findings = []

  for (const commit of commits) {
    const emails = (await runGit(root, ['show', '-s', '--format=%ae%x00%ce', commit])).toString('utf8').split('\0')
    if (emails.some((email) => email.trim() && !isNoreplyEmail(email))) {
      findings.push(finding('non-noreply-history-email', undefined, commit))
    }
    const message = (await runGit(root, ['show', '-s', '--format=%B', commit])).toString('utf8')
    for (const checkId of scanText(message, 'commit-message')) findings.push(finding(checkId, undefined, commit))
  }

  const objects = (await runGit(root, ['rev-list', '--objects', ...commits])).toString('utf8').split('\n')
  for (const object of objects) {
    const [oid, ...parts] = object.split(' ')
    if (FORBIDDEN_BLOBS.has(oid)) findings.push(finding('private-image-history', parts.join(' ')))
  }
  const tags = (await runGit(root, ['for-each-ref', '--format=%(refname)', 'refs/tags'])).toString('utf8').trim().split('\n').filter(Boolean)
  for (const tag of tags) {
    const email = (await runGit(root, ['for-each-ref', '--format=%(taggeremail:trim)', tag])).toString('utf8').trim()
    if (email && !isNoreplyEmail(email)) findings.push(finding('non-noreply-tag-email', tag))
    const message = (await runGit(root, ['for-each-ref', '--format=%(contents)', tag])).toString('utf8')
    for (const checkId of scanText(message, 'tag-message')) findings.push(finding(checkId, tag))
  }

  for (const { checkId, pattern } of HISTORY_GREP_PATTERNS) {
    const matches = splitNull(await runGit(
      root,
      ['grep', '-I', '-z', '-l', '-E', '-e', pattern, ...commits, '--'],
      { allowExitCodes: [1] },
    ))
    for (const match of matches) {
      const separator = match.indexOf(':')
      const commit = separator === 40 ? match.slice(0, separator) : undefined
      const filePath = separator === 40 ? normalizeGitPath(match.slice(separator + 1)) : normalizeGitPath(match)
      if (!isAllowedFixture(checkId, filePath)) findings.push(finding(checkId, filePath, commit))
    }
  }

  for (const commit of commits) {
    for (const filePath of splitNull(await runGit(root, ['ls-tree', '-r', '-z', '--name-only', commit]))) {
      if (isForbiddenLocalPath(filePath)) {
        findings.push(finding('forbidden-local-config-history', filePath, commit))
      }
    }
  }

  return findings
}

export async function checkMarkdownLinks(root, paths) {
  const findings = []
  for (const filePath of paths.filter((entry) => entry.endsWith('.md'))) {
    const text = await readUtf8IfPresent(root, filePath)
    if (text === null) continue
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      let target = match[1].trim().replace(/^<|>$/g, '')
      if (/^(?:https?:|mailto:|#)/i.test(target)) continue
      // Query and fragment select a browser view, not another on-disk file.
      target = target.split(/\s+["']/)[0].split(/[?#]/)[0]
      if (!target || path.isAbsolute(target)) continue
      try {
        target = decodeURI(target)
      } catch {
        findings.push(finding('invalid-markdown-link', filePath))
        continue
      }
      const resolved = path.resolve(root, path.dirname(filePath), target)
      if (!resolved.startsWith(path.resolve(root) + path.sep)) {
        findings.push(finding('markdown-link-outside-repository', filePath))
        continue
      }
      try {
        await stat(resolved)
      } catch {
        findings.push(finding('broken-markdown-link', filePath))
      }
    }
  }
  return findings
}

function requireFragments(findings, filePath, text, fragments) {
  if (text === null) return
  for (const fragment of fragments) {
    if (!text.includes(fragment)) findings.push(finding('missing-public-entry-marker', filePath))
  }
}

export async function checkPublicSurface(root, paths, config) {
  const findings = []
  const pathSet = new Set(paths)
  for (const required of REQUIRED_FILES) {
    if (!pathSet.has(required)) findings.push(finding('missing-community-file', required))
  }

  const readme = await readUtf8IfPresent(root, 'README.md')
  const readmeZh = await readUtf8IfPresent(root, 'README.zh-CN.md')
  requireFragments(findings, 'README.md', readme, [
    'Developer Preview',
    '## Start here',
    '## Product positioning',
    '## Product shape',
    '## Supported baseline',
    '## Five-minute Mock quickstart',
    '## Current maturity',
    'docs/technical-guide.md',
    'only prebuilt package channel',
    'not published to public npm',
    'CONTRIBUTING.md',
    '.github/SECURITY.md',
  ])
  requireFragments(findings, 'README.zh-CN.md', readmeZh, [
    'Developer Preview',
    '## 从这里开始',
    '## 产品定位',
    '## 产品形态',
    '## 支持基线',
    '## 五分钟 Mock 快速开始',
    '## 当前成熟度',
    'docs/technical-guide.zh-CN.md',
    '唯一的预构建安装包渠道',
    '不发布到公共 npm',
    'CONTRIBUTING.md',
    '.github/SECURITY.md',
  ])

  const manifestText = await readUtf8IfPresent(root, 'package.json')
  try {
    const manifest = JSON.parse(manifestText ?? '{}')
    if (manifest.license !== 'MIT') findings.push(finding('package-license-contract', 'package.json'))
    if (manifest.private !== true) findings.push(finding('package-private-contract', 'package.json'))
    if (manifest.scripts?.['public:check'] !== 'node scripts/check-public-readiness.mjs') {
      findings.push(finding('public-check-script-contract', 'package.json'))
    }
  } catch {
    findings.push(finding('package-json-invalid', 'package.json'))
  }

  const releaseWorkflow = await readUtf8IfPresent(root, '.github/workflows/release.yml')
  if (releaseWorkflow?.includes('npm publish') || !releaseWorkflow?.includes('gh release create')) {
    findings.push(finding('release-only-contract', '.github/workflows/release.yml'))
  }
  const ciWorkflow = await readUtf8IfPresent(root, '.github/workflows/ci.yml')
  if (!ciWorkflow?.includes('pnpm public:check')) findings.push(finding('ci-public-check-contract', '.github/workflows/ci.yml'))

  if (config.distribution?.sourceLicense !== 'MIT'
    || config.distribution?.packageChannel !== 'github-release'
    || config.distribution?.packagePrivate !== true
    || config.distribution?.npmPublished !== false) {
    findings.push(finding('distribution-config-contract', 'public-readiness.config.json'))
  }

  for (const screenshot of Object.values(config.screenshots ?? {})) {
    if (!screenshot || typeof screenshot.path !== 'string' || typeof screenshot.sha256 !== 'string') {
      findings.push(finding('screenshot-config-invalid', 'public-readiness.config.json'))
      continue
    }
    try {
      const digest = createHash('sha256').update(await readFile(path.join(root, screenshot.path))).digest('hex')
      if (digest !== screenshot.sha256) findings.push(finding('screenshot-hash-mismatch', screenshot.path))
    } catch {
      findings.push(finding('screenshot-missing', screenshot.path))
    }
  }

  return findings
}

// A hash binds a review to the actual bytes; it cannot certify their content.
export async function checkReviewedMedia(root, paths) {
  const inventoryPath = 'public-media-review.json'
  let inventory
  try {
    inventory = JSON.parse(await readFile(path.join(root, inventoryPath), 'utf8'))
    if (!Array.isArray(inventory.files)) throw new Error('invalid inventory')
  } catch {
    return [finding('media-review-inventory-invalid', inventoryPath)]
  }
  const current = new Set(paths.filter(p => /\.(?:png|jpe?g|gif|webp|avif|heic|svg|mp4|mov|webm|m4v)$/i.test(p)))
  const reviewed = new Map()
  const findings = []
  for (const entry of inventory.files) {
    if (!entry || typeof entry.path !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || !Array.isArray(entry.review) || !entry.review.length || !entry.retention || reviewed.has(entry.path)) {
      findings.push(finding('media-review-entry-invalid', inventoryPath))
      continue
    }
    reviewed.set(entry.path, entry)
    if (!current.has(entry.path)) findings.push(finding('media-review-stale-entry', entry.path))
  }
  for (const filePath of current) {
    const entry = reviewed.get(filePath)
    if (!entry) {
      findings.push(finding('media-review-required', filePath))
      continue
    }
    const digest = createHash('sha256').update(await readFile(path.join(root, filePath))).digest('hex')
    if (digest !== entry.sha256) findings.push(finding('media-review-content-changed', filePath))
  }
  return findings
}

function uniqueFindings(findings) {
  const seen = new Set()
  return findings.filter((entry) => {
    const key = `${entry.checkId}\0${entry.path ?? ''}\0${entry.commit ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function checkRepository(root = DEFAULT_ROOT) {
  const resolvedRoot = path.resolve(root)
  const configText = await readUtf8IfPresent(resolvedRoot, 'public-readiness.config.json')
  if (configText === null) {
    return { findings: [finding('readiness-config-missing', 'public-readiness.config.json')], fileCount: 0, commitCount: 0 }
  }

  let config
  try {
    config = JSON.parse(configText)
  } catch {
    return { findings: [finding('readiness-config-invalid', 'public-readiness.config.json')], fileCount: 0, commitCount: 0 }
  }

  const paths = await collectCurrentPaths(resolvedRoot)
  const commits = await collectPublishedCommits(resolvedRoot)
  const findings = [
    ...(await scanCurrentFiles(resolvedRoot, paths)),
    ...(await scanHistory(resolvedRoot, commits)),
    ...(await checkPublicSurface(resolvedRoot, paths, config)),
    ...(await checkMarkdownLinks(resolvedRoot, paths)),
    ...(await checkReviewedMedia(resolvedRoot, paths)),
  ]

  return {
    findings: uniqueFindings(findings),
    fileCount: paths.length,
    commitCount: commits.length,
  }
}

function parseRootArgument(argv) {
  if (argv.length === 0) return DEFAULT_ROOT
  if (argv.length === 2 && argv[0] === '--root' && argv[1]) return path.resolve(argv[1])
  throw new Error('usage: check-public-readiness.mjs [--root <repository>]')
}

async function main() {
  const root = parseRootArgument(process.argv.slice(2))
  const result = await checkRepository(root)
  if (result.findings.length > 0) {
    for (const entry of result.findings) process.stderr.write(`${formatFinding(entry)}\n`)
    process.stderr.write(`Public readiness: FAILED (${result.findings.length} finding(s))\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(`Public readiness: OK (${result.fileCount} files, ${result.commitCount} reachable commits; no history exemptions)\n`)
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`Public readiness: ERROR (${safeIdentifier(error instanceof Error ? error.message : 'unknown')})\n`)
    process.exitCode = 1
  })
}
