/** History selection is independent of running, authoring and evidence actions. */
export function createHistoryView({ $, t, node, onSelect }) {
  const sourceLabel = source => t(source === 'agent' ? 'agentSource' : source === 'import' ? 'importSource' : 'viewerSource')
  function render(history, selectedId) {
    const root = $('wb-history'); root.replaceChildren()
    if (!history.length) root.append(node('p', t('empty'), 'wb-note'))
    for (const run of history) {
      const button = node('button', undefined, 'wb-history-item'); button.type = 'button'; button.dataset.runId = run.id
      button.classList.toggle('selected', run.id === selectedId)
      button.append(node('strong', run.name), node('span', t(run.verdict === 'recovered' ? 'aiRecovered' : run.verdict ?? run.phase), `wb-verdict ${run.verdict ?? ''}`), node('small', `${sourceLabel(run.source)} · ${new Date(run.startedAt).toLocaleString()}`))
      button.addEventListener('click', () => onSelect(run.id))
      root.append(button)
    }
  }
  return { render, sourceLabel }
}
