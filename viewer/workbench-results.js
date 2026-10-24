/** A read-only rendering of the shared result projection, without verdict inference. */
export function renderResultHeading(root, run, { t, node }) {
  const heading = node('div', undefined, run.productContract?.contractVersion === 2 ? 'wb-row wb-runtime-heading' : 'wb-row')
  heading.append(node('h2', run.name), node('strong', t(run.verdict === 'recovered' ? 'aiRecovered' : run.verdict ?? run.phase), `wb-verdict ${run.verdict ?? ''}`)); root.append(heading)
}

export function renderResultDimensions(root, run, { t, node }) {
  if (run.resultProjection) {
    const result = run.resultProjection, dimensions = result.verification
    root.append(node('p', `${t('resultReported')}: ${t(result.reportedVerdict ?? 'unknown')} · ${t('resultCurrent')}: ${t(result.verdict ?? 'unknown')} · ${t('resultEvidence')}: ${result.evidenceAvailability}`, 'wb-scope'))
    root.append(node('p', `${t('resultDimensions')}: UI ${t(dimensions.ui.status)} · ${t('business')} ${t(dimensions.business.status)} · ${t('visualResult')} ${t(dimensions.visual.status)} · ${t('resources')} ${t(dimensions.cleanup.status)} · ${t('evidence')} ${t(dimensions.evidence.status)}`, 'wb-note'))
    if (dimensions.contractVersion === 2) root.append(node('p', `${t('runtimeHealth')}: ${t(dimensions.health.status)} · ${t('runtimePerformance')}: ${t(dimensions.performance.status)}`, 'wb-runtime-dimensions wb-note'))
    for (const measure of run.measurements ?? []) root.append(node('p', `${measure.id} · automation-observed-e2e · ${Math.round(measure.elapsedMs)} / ${measure.maxElapsedMs} ms · ${t(measure.status)} · ${measure.reason}`, 'wb-measurement wb-note'))
    if (run.health) root.append(node('p', `Health · ${run.health.source} ${run.health.sourceVersion} · ${run.health.coverage} · ${run.health.durationMs} ms · ${run.health.gaps.join(', ')}`, 'wb-health wb-note'))
    if (result.reasons.length) root.append(node('p', `${t('resultReasons')}: ${result.reasons.map(item => item.code).join(', ')}`, 'wb-note'))
  }
}

export function renderProvenance(root, run, { t, node }) {
  const section = node('details', undefined, 'wb-provenance'); section.append(node('summary', t('provenance')))
  if (!run.productContract) { section.append(node('p', t('provenanceLegacy'), 'wb-note')); root.append(section); return }
  if (![1, 2].includes(run.productContract.contractVersion) || !run.productContract.provenance) { section.append(node('p', t('provenanceUnsupported'), 'wb-warning')); root.append(section); return }
  const value = (label, entry) => `${t(label)}: ${entry.value} · ${t(entry.source)}`
  const provenance = run.productContract.provenance
  for (const [label, entry] of [
    ['appVersion', provenance.app.version], ['appBuild', provenance.app.build], ['deviceOs', provenance.environment.os],
    ['driver', provenance.environment.driver], ['viewport', provenance.environment.viewport], ['sourceCommit', provenance.project.sourceCommit],
    ['backendEnvironment', provenance.project.backendEnvironment], ['testDataVersion', provenance.project.testDataVersion],
  ]) section.append(node('p', value(label, entry), 'wb-note'))
  root.append(section)
}
