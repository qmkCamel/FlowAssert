import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { parse } from 'yaml'

it('requires protected manual opt-in and preserves visual evidence without approving it', async () => {
  const ci = parse(await readFile(new URL('../.github/workflows/web-visual-acceptance.yml', import.meta.url), 'utf8'))
  expect(Object.keys(ci.on)).toEqual(['workflow_dispatch'])
  expect(ci.on.workflow_dispatch.inputs.collect_evidence).toMatchObject({ type: 'boolean', default: false, required: true })
  const job = ci.jobs.collect
  for (const boundary of ["github.event_name == 'workflow_dispatch'", 'inputs.collect_evidence', 'github.ref_protected']) expect(job.if).toContain(boundary)
  expect(job['runs-on']).toEqual(expect.arrayContaining(['self-hosted', 'macOS', 'macos-visual']))
  expect(ci.permissions).toEqual({ contents: 'read' })
  expect(ci.concurrency['cancel-in-progress']).toBe(false)
  const upload = job.steps.find((step: { uses?: string }) => step.uses?.startsWith('actions/upload-artifact@'))
  expect(upload).toMatchObject({ if: 'always()', with: { 'retention-days': 14, path: 'artifacts/visual-acceptance/' } })
  const commands = job.steps.map((step: { run?: string }) => step.run ?? '').join('\n')
  expect(commands).toContain('This job does not assert acceptance')
  expect(commands).not.toMatch(/approve|install.*global|--update/)
})
