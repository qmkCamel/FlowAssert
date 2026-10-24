import { z } from 'zod'
import { sha256 } from './content-hash.js'
import { reportDetail, reportLabel } from './workbench-report-presentation.js'
import type { TestRun } from './workbench-domain.js'
import type { SharePreview } from './workbench-share.js'

export const REPORT_TEMPLATE_VERSION = 1
export const MAX_REPORT_BYTES = 24 * 1024 * 1024
const boundedText = z.string().max(8192)
const verdict = z.enum(['pass', 'recovered', 'fail', 'cancelled', 'inconclusive', 'evidence-conflict', 'evidence-contaminated', 'unknown'])
const status = z.enum(['not-performed', 'pass', 'fail', 'inconclusive'])
const asset = z.object({ kind: z.enum(['image', 'structure']), content: z.string().max(6 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
export const reviewedReportSnapshotSchema = z.object({
  contractVersion: z.literal(1), templateVersion: z.literal(REPORT_TEMPLATE_VERSION), shareId: z.string().uuid(), generatedAt: z.string().datetime(),
  sourceVerdict: verdict, derivedStatus: z.literal('not-revalidated'), sourceTime: z.literal('withheld'),
  platform: z.enum(['android', 'ios', 'unknown']), runtimeDeclared: z.boolean(), unsupportedContract: z.boolean(),
  dimensions: z.array(z.object({ kind: z.enum(['ui', 'business', 'visual', 'cleanup', 'evidence', 'health', 'performance']), required: z.boolean(), status, limitation: z.enum(['unsupported', 'not-performed', 'inconclusive', 'failed']).optional() }).strict()).max(7),
  measurements: z.array(z.object({ elapsedMs: z.number().finite().min(0).max(86400000), maxElapsedMs: z.number().finite().positive().max(86400000), status }).strict()).max(64).default([]),
  steps: z.array(z.object({ index: z.number().int().positive(), title: boundedText, expectation: boundedText, observation: boundedText,
    status: z.enum(['running', 'passed', 'failed', 'unknown']), assets: z.array(asset).max(64), omitted: z.boolean() }).strict()).max(500),
  withheld: z.array(boundedText).max(64),
}).strict()
export type ReviewedReportSnapshot = z.infer<typeof reviewedReportSnapshotSchema>
export interface HtmlReportResult { format: 'mobile-mirror-html'; version: 1; shareId: string; filename: string; html: string; sha256: string }

const expected: Record<string, [string, string]> = {
  assertVisible: ['预期：匹配控件可见（私有定位条件已省略）', 'Expected: matching element visible (private locator omitted)'],
  assertNotVisible: ['预期：匹配控件不可见（私有定位条件已省略）', 'Expected: matching element absent (private locator omitted)'],
  assert: ['预期：已声明的断言满足（私有条件已省略）', 'Expected: declared assertion satisfied (private condition omitted)'],
  tap: ['预期：执行点击', 'Expected: execute tap'], type: ['预期：输入指定文字（输入已省略）', 'Expected: enter text (input omitted)'],
  launchApp: ['预期：打开应用（应用标识已省略）', 'Expected: open app (app identity omitted)'],
}

/** The adapter can read the source; the passive renderer below only receives this sanitized schema. */
export function createReviewedReportSnapshot(source: TestRun, preview: SharePreview, identity: { shareId: string; generatedAt: string }): ReviewedReportSnapshot {
  const detail = reportDetail(source), byName = new Map(preview.files.map(file => [file.sourceName, file]))
  const assetsFor = (files: TestRun['evidence']) => files.flatMap(file => {
    const value = byName.get(file.name)
    if (!value) return []
    const bytes = value.kind === 'image' ? Buffer.from(value.preview.split(',')[1] ?? '', 'base64') : Buffer.from(value.preview)
    return [{ kind: value.kind, content: value.preview, sha256: sha256(bytes) }]
  })
  const steps = source.steps.map(step => {
    const known = expected[step.kind], assets = assetsFor(step.evidence)
    return { index: step.index, title: known ? `${reportLabel(step.kind, 'zh-CN')} / ${reportLabel(step.kind, 'en')}` : '步骤 / Step',
      expectation: known?.join(' / ') ?? '预期的私有细节已省略 / Private expectation details omitted',
      observation: `${reportLabel(step.status, 'zh-CN')} / ${reportLabel(step.status, 'en')}；原始观察文字已省略 / Raw observation text omitted`,
      status: ['running', 'passed', 'failed'].includes(step.status) ? step.status : 'unknown', assets, omitted: !assets.length }
  })
  const runAssets = assetsFor(source.evidence)
  if (runAssets.length) steps.push({ index: Math.max(0, ...steps.map(step => step.index)) + 1, title: '运行材料 / Run materials', expectation: '无步骤关联 / No step association', observation: '已审查派生材料 / Reviewed derived materials', status: 'unknown', assets: runAssets, omitted: false })
  return reviewedReportSnapshotSchema.parse({ contractVersion: 1, templateVersion: REPORT_TEMPLATE_VERSION, ...identity,
    sourceVerdict: source.share?.reportedVerdict ?? detail.projection.reportedVerdict ?? 'unknown', derivedStatus: 'not-revalidated', sourceTime: 'withheld', platform: source.platform,
    runtimeDeclared: detail.runtimeDeclared, unsupportedContract: detail.projection.readState === 'unsupported',
    dimensions: detail.dimensions.map(({ kind, required, status, ...rest }) => ({ kind, required, status, ...('reason' in rest && rest.reason === 'health-source-unsupported' ? { limitation: 'unsupported' } : {}) })), measurements: detail.measurements.map(item => ({ elapsedMs: item.elapsedMs, maxElapsedMs: item.maxElapsedMs, status: item.status })), steps,
    withheld: [...preview.withheld, 'Run name, original times, private labels, expected/observed free text and runtime identifiers/reasons omitted; displayed expectation text is a type-level template, not the exact source assertion.'] })
}

const escapeText = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const label = (value: string) => `${reportLabel(value, 'zh-CN')} / ${reportLabel(value, 'en')}`

/** No store, source run, executable code, paths or network access belong in this renderer. */
export const REPORT_STYLE = 'body{font:16px/1.6 system-ui,sans-serif;background:#f5f7fb;color:#182239;margin:0}main{max-width:960px;margin:auto;padding:28px}header,article,section{background:#fff;border:1px solid #ccd4e2;border-radius:12px;padding:24px;margin:18px 0}h1{font-size:28px;line-height:1.3}h2{font-size:20px}a{color:#2049a5}a:focus-visible,summary:focus-visible{outline:3px solid #245ebf}img{max-width:100%;height:auto;max-height:900px;object-fit:contain}pre{white-space:pre-wrap;overflow-wrap:anywhere}p,li{overflow-wrap:anywhere}.warning{border-left:4px solid #996000;padding-left:16px}.status{font-weight:700}nav{display:flex;flex-wrap:wrap;gap:16px}figure{margin:12px 0}summary{cursor:pointer}@media print{body{background:white}main{padding:0}article{break-inside:avoid}details{display:block}a{color:inherit}}'
export const REPORT_STYLE_CSP_HASH = `sha256-${Buffer.from(sha256(REPORT_STYLE), 'hex').toString('base64')}`

export function renderReviewedReport(value: unknown): HtmlReportResult {
  const snapshot = reviewedReportSnapshotSchema.parse(value)
  if (new Set(snapshot.steps.map(step => step.index)).size !== snapshot.steps.length) throw new Error('Duplicate report step index')
  let textBytes = 0, totalBytes = 0, assetCount = 0
  const budgetText = (text: string) => { const bytes = Buffer.byteLength(text); if (bytes > 8192 || (textBytes += bytes) > 256 * 1024) throw new Error('Report text exceeds budget'); return escapeText(text) }
  const assets = (items: ReviewedReportSnapshot['steps'][number]['assets']) => items.map(item => {
    if (++assetCount > 64) throw new Error('Report asset count exceeds budget')
    if (item.kind === 'image') {
      if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(item.content)) throw new Error('Invalid report PNG')
      const bytes = Buffer.from(item.content.slice('data:image/png;base64,'.length), 'base64')
      if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(20) < 1 || bytes.readUInt32BE(16) > 4096 || bytes.readUInt32BE(20) > 4096) throw new Error('Invalid report PNG dimensions')
      if (bytes.length > 4 * 1024 * 1024 || (totalBytes += bytes.length) > 16 * 1024 * 1024 || sha256(bytes) !== item.sha256) throw new Error('Report asset integrity or budget failed')
      return `<figure><img alt="已审查截图 / Reviewed screenshot" src="${item.content}"><figcaption>派生像素 / Derived pixels</figcaption></figure>`
    }
    const bytes = Buffer.from(item.content)
    if (bytes.length > 4 * 1024 * 1024 || (totalBytes += bytes.length) > 16 * 1024 * 1024 || sha256(bytes) !== item.sha256) throw new Error('Report asset integrity or budget failed')
    return `<details open><summary>结构（已脱敏） / Sanitized structure</summary><pre>${budgetText(item.content)}</pre></details>`
  }).join('')
  const dimensions = snapshot.dimensions.map(item => `<li>${budgetText(label(item.kind))}: ${budgetText(label(item.status))}${item.required ? '（必需 / Required）' : ''}${item.limitation === 'unsupported' ? ' · 未支持 / Unsupported' : ''}</li>`).join('')
  const steps = snapshot.steps.map(step => `<article id="step-${step.index}"><h2>${step.index}. ${budgetText(step.title)}</h2><p class="status">${budgetText(label(step.status))}</p><p>${budgetText(step.expectation)}</p><p>${budgetText(step.observation)}</p>${assets(step.assets)}${step.omitted ? '<p>该步骤的材料未包含 / Evidence for this step not included</p>' : ''}</article>`).join('')
  const omitted = snapshot.withheld.map(item => `<li>${budgetText(item)}</li>`).join('')
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src '${REPORT_STYLE_CSP_HASH}'; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>FlowAssert — 审查后报告 / Reviewed report</title><style>${REPORT_STYLE}</style></head><body><main><header><h1>审查后的派生报告 / Reviewed derived report</h1><p class="warning">未重新执行验证 / Not revalidated. 本文件不证明真实来源或独立验收 / This file is not proof of source authenticity or independent acceptance.</p><p class="status">来源记录结果 / Source reported verdict: ${escapeText(label(snapshot.sourceVerdict))}</p><p>平台 / Platform: ${snapshot.platform}</p><p>导出生成时间 / Export generated: ${snapshot.generatedAt}</p><p>原始运行时间已省略 / Original run time withheld</p><nav><a href="#scope">验证范围 / Scope</a><a href="#steps">步骤 / Steps</a><a href="#omitted">省略材料 / Omitted</a></nav></header><section id="scope"><h2>来源记录验证范围 / Source recorded verification scope</h2><ul>${dimensions}</ul>${snapshot.measurements.map((item, index) => `<p>来源记录测量 / Source recorded measurement ${index + 1}: ${item.elapsedMs} / ${item.maxElapsedMs} ms · ${escapeText(label(item.status))}</p>`).join('')}${!snapshot.runtimeDeclared ? '<p>时间、健康和性能门禁未声明；不视为通过 / Runtime gates not declared; no pass inferred.</p>' : ''}${snapshot.unsupportedContract ? '<p class="warning">来源结果契约未支持 / Unsupported source result contract</p>' : ''}</section><section id="steps"><h2>步骤目录 / Step directory</h2><nav>${snapshot.steps.map(step => `<a href="#step-${step.index}">${step.index}. ${escapeText(label(step.status))}</a>`).join('')}</nav></section>${steps}<section id="omitted"><h2>省略范围 / Withheld scope</h2><ul>${omitted}</ul><p>文字预期仅为动作类型说明，完整条件与原始观察已省略 / Expectations are type-level descriptions; exact conditions and raw observations were omitted.</p></section></main></body></html>`
  if (Buffer.byteLength(html) > MAX_REPORT_BYTES) throw new Error('HTML report exceeds budget')
  return { format: 'mobile-mirror-html', version: 1, shareId: snapshot.shareId, filename: `mobile-mirror-report-${snapshot.shareId}.html`, html, sha256: sha256(html) }
}
