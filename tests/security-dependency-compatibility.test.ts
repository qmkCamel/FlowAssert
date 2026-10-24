import { expect, it } from 'vitest'
import { safeLoadConfig } from '@appclaw/core/config'
import { matrixCellSchema } from '../src/device-matrix-contracts.js'
import { repairProjectSchema } from '../src/workbench-repair-project.js'

it('preserves nested repair budget defaults when an existing project omits its budget', () => {
  const policy = repairProjectSchema.parse({ projectId: 'demo' })
  expect(policy).toMatchObject({ enabled: false, permissions: [], budget: {
    maxAttempts: 2, baselineRuns: 1, candidateRuns: 2, maxRegressionCases: 20,
    executionMs: 600000, approvalMs: 1800000, lifetimeMs: 86400000, evidenceBytes: 67108864,
  } })
  expect(() => repairProjectSchema.parse({ projectId: 'demo', budget: { maxAttempts: 3 } })).toThrow()
  expect(() => repairProjectSchema.parse({ projectId: 'demo', permissions: ['verify', 'verify'] })).toThrow()
})

it('round-trips arbitrary JSON matrix parameters and still rejects unknown contract fields', () => {
  const base = { id: 'one', slotId: 'phone', flow: 'demo', fixture: { parallelSafe: true, namespace: 'one', resourceKeys: [] } }
  expect(matrixCellSchema.parse(base).params).toEqual({})
  const params = { enabled: false, retries: 0, nested: { list: [null, 'text', 3] } }
  expect(matrixCellSchema.parse({ ...base, params }).params).toEqual(params)
  expect(() => matrixCellSchema.parse({ ...base, params: [], extra: true })).toThrow()
})

it('preserves AppClaw boolean transforms and invalid-config recovery with the patched schema library', () => {
  const { config, issues } = safeLoadConfig({ LLM_PROVIDER: 'not-a-provider', MCP_PORT: 'not-a-port',
    VISION_LOCATE_LOG: 'false', SHOW_TOKEN_USAGE: 'true', CLOUD_PROVIDER: '' })
  expect(issues.map(issue => issue.key)).toEqual(expect.arrayContaining(['LLM_PROVIDER', 'MCP_PORT']))
  expect(config.LLM_PROVIDER).toBe('gemini')
  expect(config.MCP_PORT).toBe(8080)
  expect(config.VISION_LOCATE_LOG).toBe(false)
  expect(config.SHOW_TOKEN_USAGE).toBe(true)
})
