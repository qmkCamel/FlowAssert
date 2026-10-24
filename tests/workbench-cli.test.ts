import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { runSuiteCli } from '../src/workbench-cli.js'
import { randomUUID } from 'node:crypto'
import { repairBudgetSchema } from '../src/workbench-repair-contracts.js'

const closes: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close() })

describe('workbench attach CLI', () => {
  it('uses only a loopback Viewer for bounded repair mutations and refuses non-interactive approval', async () => {
    const id = randomUUID(), source = randomUUID(), baseline = randomUUID(), requestId = randomUUID(), seen: string[] = []
    const server = createServer((request, response) => {
      seen.push(`${request.method} ${request.url}`)
      response.writeHead(request.url === '/api/workbench/repairs' ? 202 : 200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ caseId: id, revision: 4, phase: 'queued' }))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    closes.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture listener')
    const url = `http://127.0.0.1:${address.port}/`, output: string[] = [], errors: string[] = []
    const io = { stdout: { write: (value: string) => output.push(value) }, stderr: { write: (value: string) => errors.push(value) } }
    expect(await runSuiteCli(['repair', 'create', '--source-run', source, '--baseline-run', baseline,
      '--flow', 'demo', '--request-id', requestId, '--url', url], io)).toBe(0)
    expect(await runSuiteCli(['repair', 'verify', '--id', id, '--url', url, '--start', '--expected-revision', '4'], io)).toBe(0)
    expect(await runSuiteCli(['repair', 'cancel', '--id', id, '--url', url, '--expected-revision', '4'], io)).toBe(0)
    expect(await runSuiteCli(['repair', 'retire', '--id', id, '--url', url, '--expected-revision', '4', '--confirm-id', id], io)).toBe(0)
    expect(await runSuiteCli(['repair', 'approve', '--id', id, '--url', url, '--expected-revision', '4', '--level', 'scope'], io)).toBe(2)
    expect(errors.join('')).toContain('interactive local terminal')
    expect(seen).toEqual(['POST /api/workbench/repairs', `POST /api/workbench/repairs/${id}/verify`,
      `POST /api/workbench/repairs/${id}/cancel`, `POST /api/workbench/repairs/${id}/retire`])
  })
  it('keeps software success below the default device grade and maps cancellation to 130', async () => {
    const plan = { id: randomUUID(), caseId: randomUUID(), digest: 'a'.repeat(64), projectId: 'fixture', projectRevision: 'b'.repeat(64),
      sourceSnapshot: { runId: randomUUID(), manifestSha256: 'c'.repeat(64) }, route: 'locator-maintenance',
      budget: repairBudgetSchema.parse({}), createdAt: '2026-10-03T12:00:00.000Z' }, seen: string[] = []
    let outcome: 'software-verified' | 'cancelled' = 'software-verified'
    const server = createServer((request, response) => {
      seen.push(`${request.method} ${request.url}`)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ case: { contractVersion: 1, id: plan.caseId, requestId: plan.id, requestDigest: plan.digest,
        projectId: plan.projectId, projectRevision: plan.projectRevision, owner: 'local', sourceSnapshot: plan.sourceSnapshot,
        route: plan.route, planId: plan.id, planDigest: plan.digest, phase: 'finished', outcome, revision: 3, generation: 0,
        attempts: [], approvals: [], verificationIds: [], budget: plan.budget, spentExecutionMs: 0,
        createdAt: plan.createdAt, updatedAt: plan.createdAt, expiresAt: '2026-10-04T12:00:00.000Z' } }))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    closes.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture listener')
    const base = ['repair', 'verify', '--id', plan.caseId, '--url', `http://127.0.0.1:${address.port}/`]
    const output = { stdout: { write: (_value: string) => {} }, stderr: { write: (_value: string) => {} } }
    expect(await runSuiteCli(base, output)).toBe(1)
    expect(await runSuiteCli([...base, '--required-grade', 'software'], output)).toBe(0)
    outcome = 'cancelled'
    expect(await runSuiteCli(base, output)).toBe(130)
    expect(seen).toEqual(Array(3).fill(`GET /api/workbench/repairs/${plan.caseId}`))
  })
  it('leaves an external Viewer runtime running after the attached suite completes', async () => {
    const requests: string[] = []
    const suite = { id: '11111111-1111-4111-8111-111111111111', name: 'fixture', registeredId: 'smoke', phase: 'finished', startedAt: new Date().toISOString(), sessionId: 'external', cases: [], project: {}, snapshotSha256: '', stopOnFailure: false, timeoutMs: 1_000, exitCode: 0 }
    const server = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`)
      response.writeHead(request.method === 'POST' || request.method === 'GET' ? 200 : 405, { 'content-type': 'application/json' })
      response.end(JSON.stringify(suite))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    closes.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture listener')
    const stdout: string[] = [], stderr: string[] = []
    expect(await runSuiteCli(['suite', 'smoke', '--url', `http://127.0.0.1:${address.port}/`], { stdout: { write: (value) => stdout.push(value) }, stderr: { write: (value) => stderr.push(value) } })).toBe(0)
    expect(stderr).toEqual([])
    expect(requests).toEqual(['POST /api/suites'])
    expect(server.listening).toBe(true)
  })
  it('returns triage-operation success separately from the original failing test verdict', async () => {
    const requests: string[] = []
    const job = { jobId: '11111111-1111-4111-8111-111111111111', reportId: '22222222-2222-4222-8222-222222222222', state: 'succeeded', targetRunId: '33333333-3333-4333-8333-333333333333' }
    const server = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(request.url?.includes('triage-reports') ? { report: { reportedVerdict: 'fail', effectiveVerdict: 'fail', disposition: 'actionable' }, availability: 'verified' } : job))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    closes.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture listener')
    const stdout: string[] = [], stderr: string[] = []
    const code = await runSuiteCli(['triage', 'start', job.targetRunId, '--url', `http://127.0.0.1:${address.port}/`, '--wait'],
      { stdout: { write: value => stdout.push(value) }, stderr: { write: value => stderr.push(value) } })
    expect(code).toBe(0)
    expect(stdout.join('')).toContain('"reportedVerdict":"fail"')
    expect(stderr).toEqual([])
    expect(requests).toEqual(['POST /api/workbench/triage-jobs', `GET /api/workbench/triage-reports/${job.reportId}`])
  })
})
