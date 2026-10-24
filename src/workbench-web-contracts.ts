import { z } from 'zod'
import type { EvidenceFile, TestRun } from './workbench-domain.js'

export const webScenarioSchema = z.enum(['VA-01', 'VA-02', 'VA-03', 'VA-04', 'VA-05', 'VA-06', 'VA-07', 'VA-08'])
export const webCaseSchema = z.object({ name: z.string().trim().min(1).max(160), tags: z.array(z.string().trim().min(1).max(32)).max(10),
  platform: z.literal('web'), executionKind: z.literal('web'), target: z.literal('synthetic-viewer'), scenarioVersion: z.literal(1),
  scenarios: z.array(webScenarioSchema).min(1).max(8).refine(items => new Set(items).size === items.length),
  calibration: z.enum(['none', 'covered-play', 'shifted-marker', 'hidden-retry', 'narrow-overflow']).default('none') }).strict()
export type WebCase = z.infer<typeof webCaseSchema>
export interface WebStep {
  index: number; kind: z.infer<typeof webScenarioSchema>; status: 'running' | 'passed' | 'failed'; startedAt: string; endedAt?: string
  evidence: EvidenceFile[]; checks: { name: string; pass: boolean; actual?: unknown }[]; facts?: unknown; error?: string
  execution?: string; session?: string; actions?: number
}
export interface WebTestRun {
  schemaVersion: 1; executionKind: 'web'; id: string; name: string; platform: 'web'; engine: 'agent-browser'; source: 'viewer'
  phase: 'running' | 'cancelling' | 'finalizing' | 'finished'; verdict?: 'pass' | 'fail' | 'cancelled' | 'inconclusive'
  startedAt: string; endedAt?: string; steps: WebStep[]; evidence: EvidenceFile[]; input: WebCase; parentRunId?: string
  authoringOrigin: { caseId: string; revisionId: string; inputDigest: string }
  requestId: string
  visualReview: { status: 'needs-review' | 'pass' | 'fail'; reviewer?: string; observations?: string; at?: string; hashes?: string[] }
  independentCheck: 'pending' | 'pass' | 'fail'; baseline: 'not-compared' | 'matched' | 'changed' | 'incomparable'
  cleanup: 'pending' | 'complete' | 'failed'; error?: string
  resources: { owner: string; aPid: number; aRoot: string; bRoot?: string; bPid?: number; bOrigin?: string; targetRunId?: string; buildSha256?: string; sessions: string[] }
  environment?: Record<string, unknown>; recovery?: { at: string; reason: string }
}
export type WorkbenchRun = TestRun | WebTestRun
export function isWebRun(run: unknown): run is WebTestRun { return Boolean(run && typeof run === 'object' && 'executionKind' in run && run.executionKind === 'web') }
export function validateWebRun(value: WebTestRun): WebTestRun {
  if (value.schemaVersion !== 1 || !z.string().uuid().safeParse(value.id).success || value.platform !== 'web' || value.engine !== 'agent-browser'
    || !['running', 'cancelling', 'finalizing', 'finished'].includes(value.phase) || !Array.isArray(value.steps) || !Array.isArray(value.evidence)
    || ['sessionId', 'appId', 'deviceName', 'yaml'].some(key => key in value)) throw new Error('Invalid Web run manifest')
  webCaseSchema.parse(value.input)
  z.object({ source:z.literal('viewer'), name:z.string().min(1), startedAt:z.string().datetime(), requestId:z.string().uuid(),
    verdict:z.enum(['pass','fail','cancelled','inconclusive']).optional(), cleanup:z.enum(['pending','complete','failed']),
    independentCheck:z.enum(['pending','pass','fail']), baseline:z.enum(['not-compared','matched','changed','incomparable']),
    authoringOrigin:z.object({caseId:z.string().uuid(),revisionId:z.string().uuid(),inputDigest:z.string().regex(/^[a-f0-9]{64}$/)}),
    visualReview:z.object({status:z.enum(['needs-review','pass','fail'])}),
    resources:z.object({owner:z.string().min(1),aPid:z.number().int().positive(),aRoot:z.string().min(1),sessions:z.array(z.string())}),
  }).parse(value)
  for (const step of value.steps) { webScenarioSchema.parse(step.kind); if (!Number.isSafeInteger(step.index) || !Array.isArray(step.checks) || !Array.isArray(step.evidence)) throw new Error('Invalid Web step') }
  return value
}
