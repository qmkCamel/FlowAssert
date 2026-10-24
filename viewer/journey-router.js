const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
export function parseJourneyRoute(hash) {
  if (!hash || hash === '#/' || hash === '#/workbench') return { page: 'cases' }
  if (/^#\/(cases|runs|devices|manage|legacy)$/.test(hash)) return { page: hash.slice(2) }
  if (hash === '#/cases/new') return { page: 'edit', id: null }
  const edit = new RegExp(`^#/cases/(${uuid})/edit$`).exec(hash)
  if (edit) return { page: 'edit', id: edit[1] }
  const run = new RegExp(`^#/runs/(${uuid})(?:\\?([^#]*))?$`).exec(hash)
  if (run) {
    const query = new URLSearchParams(run[2] ?? '')
    if ([...query.keys()].some(key => !['step', 'tab'].includes(key)) || [...query.keys()].length !== new Set(query.keys()).size) return { page: 'missing' }
    const raw = query.get('step'), tab = query.get('tab') ?? 'evidence'
    if (raw !== null && !/^[1-9][0-9]{0,5}$/.test(raw) || !['summary', 'steps', 'evidence', 'details', 'compare', 'triage', 'share'].includes(tab)) return { page: 'missing' }
    return { page: 'analysis', id: run[1], step: raw === null ? null : Number(raw), tab }
  }
  return { page: 'missing' }
}
