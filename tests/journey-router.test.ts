import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'

// Browser-independent route parser is loaded without importing any DOM code.
const code = await readFile(new URL('../viewer/journey-router.js', import.meta.url), 'utf8')
const { parseJourneyRoute: parse } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const id = '11111111-1111-4111-a111-111111111111'
it('whitelists routes and bounded selection without accepting data or credentials in URLs', () => {
  expect(parse('')).toEqual({ page: 'cases' })
  expect(parse('#/workbench')).toEqual({ page: 'cases' })
  expect(parse(`#/runs/${id}?step=2&tab=details`)).toEqual({ page: 'analysis', id, step: 2, tab: 'details' })
  expect(parse(`#/cases/${id}/edit`)).toEqual({ page: 'edit', id })
  for (const hash of ['#/runs/wrong', '#/cases/../../edit', `#/runs/${id}?yaml=secret`, `#/runs/${id}?step=-1`, `#/runs/${id}?step=2&step=3`, `#/runs/${id}?tab=unknown`, `#/runs/${id}?step=1000000`]) expect(parse(hash)).toEqual({ page: 'missing' })
})
