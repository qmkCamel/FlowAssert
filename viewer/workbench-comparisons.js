export function createComparisonPanel({ t, node, api, selectedRunId, history, currentRun, rerender, showError, requireExplicitBaseline = false }) {
  let comparisonId = null, comparison = null, diagnosticContext = null, diagnosticFor = null
  let candidateRunId = null, candidateFor = null, candidateList = []
  let pendingAction = null
  let actionEpoch = 0
  let previousReport = null
  const update = (run) => { if (currentRun()?.id === run.id) rerender() }
  return {
    current() { return comparison },
    async poll() {
      if (pendingAction || !comparisonId || !comparison || !['queued', 'running'].includes(comparison.state)) return
      const id = comparisonId, epoch = actionEpoch
      try { const value = await api(`/api/workbench/comparisons/${id}`); if (!pendingAction && comparisonId === id && epoch === actionEpoch) { comparison = value; rerender() } }
      catch (error) { if (!pendingAction && comparisonId === id && epoch === actionEpoch) showError(error.message) }
    },
    render(root, run) {
      const section = node('section', undefined, 'wb-comparison'); section.append(node('h3', t('compare')))
      if (!run.comparison) { section.append(node('p', t('compareUnavailable'), 'wb-note')); root.append(section); return }
      const row = node('div', undefined, 'wb-row'), select = node('select'); select.id = 'wb-comparison-baseline'; select.setAttribute('aria-label', t('compareBaseline'))
      const button = node('button', t('compareStart'), 'check-button'); button.type = 'button'; button.disabled = true
      row.append(select, button); section.append(row)
      if (candidateFor !== run.id) {
        candidateFor = run.id; candidateRunId = null; candidateList = []
        void api(`/api/workbench/comparison-candidates?runId=${run.id}`).then((data) => {
          if (selectedRunId() !== run.id) { if (candidateFor === run.id) candidateFor = null; return }
          candidateList = data.candidates
          candidateRunId = requireExplicitBaseline ? null : data.candidates[0]?.id ?? history().find((item) => item.id !== run.id && item.phase === 'finished')?.id ?? null
          update(run)
        }).catch((error) => showError(error.message))
      }
      const recommended = new Set(candidateList.map((item) => item.id))
      if (requireExplicitBaseline) { const placeholder = node('option', document.documentElement.lang === 'zh-CN' ? '请明确选择并审查基线适用性' : 'Select a baseline and review applicability'); placeholder.value = ''; select.append(placeholder) }
      for (const candidate of candidateList) {
        const option = node('option', `${candidate.name} · ${new Date(candidate.startedAt).toLocaleString()}${candidate.environmentMatch ? '' : ' · environment changed'}`)
        option.value = candidate.id; select.append(option)
      }
      for (const item of history().filter((item) => item.id !== run.id && item.phase === 'finished' && !recommended.has(item.id))) {
        const option = node('option', `${item.name} · manual / review only`); option.value = item.id; select.append(option)
      }
      if (candidateRunId) select.value = candidateRunId
      const active = comparison && ['queued', 'running'].includes(comparison.state)
      button.disabled = !candidateRunId || !!pendingAction || active
      select.disabled = !!pendingAction || active
      if (pendingAction) {
        const status = node('p', t(pendingAction === 'cancel' ? 'compareCancelling' : 'compareLoading'), 'wb-note')
        status.setAttribute('role', 'status'); section.append(status)
      }
      if (!select.options.length) section.append(node('p', t('compareNoCandidate'), 'wb-note'))
      select.onchange = () => { candidateRunId = select.value; button.disabled = !candidateRunId || !!pendingAction || active }
      button.onclick = async () => {
        if (!candidateRunId || pendingAction || active) return
        const baselineRunId = candidateRunId
        if (comparison && ['completed', 'partial'].includes(comparison.state)) previousReport = comparison
        actionEpoch++; pendingAction = 'start'; showError(null); rerender()
        try {
          comparison = await api('/api/workbench/comparisons', { baselineRunId, targetRunId: run.id })
          comparisonId = comparison.id; diagnosticContext = null; diagnosticFor = null; update(run)
        } catch (error) { showError(error.message) }
        finally { pendingAction = null; rerender() }
      }
      if (comparison && comparison.targetRunId === run.id) {
        section.append(node('p', comparison.state === 'queued' || comparison.state === 'running' ? `${t('compareLoading')} · ${comparison.progress}` : `${t('compareReport')} · ${comparison.state}`, `wb-note ${comparison.state === 'partial' ? 'wb-warning' : ''}`))
        if (['queued', 'running'].includes(comparison.state)) {
          const cancel = node('button', t('compareCancel'), 'text-button'); cancel.type = 'button'
          cancel.disabled = !!pendingAction
          cancel.onclick = async () => {
            if (pendingAction) return
            const id = comparison.id
            actionEpoch++; pendingAction = 'cancel'; rerender()
            try { const value = await api(`/api/workbench/comparisons/${id}/cancel`, {}); if (comparisonId === id) comparison = value }
            catch (error) { showError(error.message) }
            finally { pendingAction = null; rerender() }
          }
          section.append(cancel)
        }
        for (const limitation of comparison.limitations ?? []) section.append(node('p', limitation, 'wb-note'))
        if (comparison.firstConfirmedDifference) section.append(node('strong', `${t('compareFirst')}: ${comparison.firstConfirmedDifference.index + 1}${comparison.firstConfirmedDifference.qualified ? '' : ` · ${t('comparePartial')}`}`))
        if (comparison.classifications?.length) {
          section.append(node('h3', t('compareFacts')))
          for (const item of comparison.classifications) section.append(node('p', `${item.domain}: ${item.facts.join('; ')}`, 'wb-note'))
        }
        for (const [index, item] of (comparison.steps ?? []).entries()) {
          const details = node('details', undefined, 'wb-comparison-step')
          details.append(node('summary', `${index + 1}. ${item.path ?? item.relation} · ${item.divergent ? 'different' : 'same'}`))
          for (const [name, value] of Object.entries(item.dimensions)) details.append(node('p', `${name}: ${value.status} · ${value.reason}`, 'wb-note'))
          section.append(details)
        }
        for (const artifact of comparison.artifacts ?? []) {
          const image = node('img'); image.loading = 'lazy'; image.alt = 'Pixel difference'
          image.src = `/api/workbench/comparisons/${comparison.id}/artifacts/${artifact.id}`; section.append(image)
        }
        if (['completed', 'partial'].includes(comparison.state)) {
          if (diagnosticFor !== comparison.id) {
            diagnosticFor = comparison.id; diagnosticContext = null
            void api(`/api/workbench/comparisons/${comparison.id}/diagnostic-context`).then((value) => {
              if (comparison?.id !== value.comparison.id) return
              diagnosticContext = value; rerender()
            }).catch((error) => showError(error.message))
          }
          if (diagnosticContext?.comparison.id === comparison.id) {
            section.append(node('h3', t('diagnosticContext')), node('p', t('diagnosticBoundary'), 'wb-note'))
            const coverage = diagnosticContext.evidenceCoverage
            section.append(node('p', `${t('diagnosticCoverage')}: ${coverage.dimensions.complete} complete · ${coverage.dimensions.partial} partial · ${coverage.registeredEvidence} refs`, 'wb-note'))
            if (diagnosticContext.firstDivergence) {
              const first = diagnosticContext.firstDivergence; section.append(node('strong', `${first.kind} · ${first.step.path}`))
              for (const fact of first.facts) section.append(node('p', `${fact.dimension}: ${fact.reason}`, 'wb-note'))
            } else section.append(node('p', t('diagnosticNoDivergence'), 'wb-note'))
            for (const ref of diagnosticContext.drillDown.evidenceRefs) {
              const inspect = node('button', `${t('diagnosticDrill')} · ${ref.slice(-8)}`, 'text-button'); inspect.type = 'button'
              inspect.onclick = async () => {
                try { const value = await api(`/api/workbench/comparisons/${comparison.id}/evidence/${encodeURIComponent(ref)}`); window.open(value.artifactUrl, '_blank', 'noopener') }
                catch (error) { showError(error.message) }
              }
              section.append(inspect)
            }
          }
          const link = node('a', t('compareDownload')); link.href = `/api/workbench/comparisons/${comparison.id}/report`; link.download = `comparison-${comparison.id}.json`; section.append(link)
        }
      }
      if (previousReport?.targetRunId === run.id && comparison?.id !== previousReport.id) {
        const retained = node('section', undefined, 'wb-retained-comparison')
        retained.append(node('h3', document.documentElement.lang === 'zh-CN' ? '上一份可用报告（旧输入，未被本次操作覆盖）' : 'Previous usable report (prior inputs; retained)'))
        retained.append(node('p', `${previousReport.baselineRunId} → ${previousReport.targetRunId} · ${previousReport.state}`, 'wb-note'))
        const details = node('details'); details.append(node('summary', t('compareReport')), node('pre', JSON.stringify(previousReport, null, 2))); retained.append(details)
        const link = node('a', t('compareDownload')); link.href = `/api/workbench/comparisons/${previousReport.id}/report`; link.download = `comparison-${previousReport.id}.json`; retained.append(link); section.append(retained)
      }
      root.append(section)
    },
  }
}
