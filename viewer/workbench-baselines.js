/** Baseline preview/approval owns its own busy, review and late-response state. */
export function createBaselinePanel({ $, t, node, api, currentRun }) {
  let profiles = null, candidate = null, busy = false, status = '', updatedAt = null, revision = 0
  let reviewerAlias = '', reviewed = false, imageSignature = ''
  function render() {
    const profileSelect = $('wb-baseline-profile'), imageSelect = $('wb-baseline-image')
    const profileId = profileSelect.value
    profileSelect.replaceChildren(...(profiles?.profiles ?? []).map(profile => {
      const option = node('option', `${profile.id} · ${profile.platform} · r${profile.approved[0]?.revision ?? 0}`)
      option.value = profile.id; return option
    }))
    if ([...profileSelect.options].some(option => option.value === profileId)) profileSelect.value = profileId
    const fromRun = $('wb-baseline-source').value === 'run'
    imageSelect.hidden = !fromRun
    const imageName = imageSelect.value, run = currentRun()
    const files = run ? [...(run.evidence ?? []), ...(run.steps ?? []).flatMap(step => step.evidence ?? [])].filter(file => file.contentType === 'image/png') : []
    imageSelect.replaceChildren(...files.map(file => { const option = node('option', file.name); option.value = file.name; return option }))
    if ([...imageSelect.options].some(option => option.value === imageName)) imageSelect.value = imageName
    $('wb-baseline-load').disabled = busy
    $('wb-baseline-preview').disabled = busy || !profileSelect.value || (fromRun && (!run || !imageSelect.value))
    $('wb-baseline-status').textContent = status || (updatedAt ? `${t('baselineApproved')} · ${updatedAt.toLocaleString()}` : t('baselineEmpty'))
    const root = $('wb-baseline-results'); root.replaceChildren()
    if (!candidate) return
    const view = candidate
    const preview = node('details'); preview.open = true
    preview.append(node('summary', `${t('baselineReady')} · ${view.profileId} r${view.expectedRevision + 1}`))
    preview.append(node('p', `${view.sourceKind}${view.sourceRunId ? ` · ${view.sourceRunId}` : ''} · ${view.sourceBuild} → ${view.allowedTargetBuilds.join(', ')}`, 'wb-note'))
    preview.append(node('p', `image SHA-256 ${view.sourceImageSha256} · rules SHA-256 ${view.rulesHash} · ${view.width}×${view.height} · ${view.expiresAt}`, 'wb-note'))
    const image = node('img'); image.alt = `Baseline candidate ${view.profileId}`; image.src = `data:image/png;base64,${view.imageBase64}`; preview.append(image)
    const reviewer = node('input'); reviewer.type = 'text'; reviewer.maxLength = 160; reviewer.placeholder = t('baselineReviewer'); reviewer.autocomplete = 'off'; reviewer.value = reviewerAlias
    const checked = node('input'); checked.type = 'checkbox'; checked.checked = reviewed
    const label = node('label'); label.append(checked, document.createTextNode(` ${t('baselineReview')}`))
    const approve = node('button', t('baselineApprove'), 'check-button'); approve.type = 'button'; approve.disabled = true
    const update = () => { reviewerAlias = reviewer.value; reviewed = checked.checked; approve.disabled = busy || !checked.checked || !reviewer.value.trim() }
    checked.onchange = update; reviewer.oninput = update; update()
    approve.onclick = async () => {
      if (busy || !checked.checked || !reviewer.value.trim()) return
      busy = true; status = t('baselineApproving'); approve.disabled = true; $('wb-baseline-preview').disabled = true; $('wb-baseline-load').disabled = true; $('wb-baseline-status').textContent = status
      try {
        const result = await api('/api/workbench/baselines/approve', { candidateId: view.candidateId, digest: view.digest, approvalRequestId: view.approvalRequestId, approvedBy: reviewer.value.trim(), reviewed: true })
        candidate = null; reviewed = false; profiles = await api('/api/workbench/baselines'); updatedAt = new Date(); status = `${t('baselineApproved')}: ${result.profileId} r${result.revision}`
      } catch (error) { status = error.message }
      finally { busy = false; render() }
    }
    preview.append(reviewer, label, approve); root.append(preview)
  }
  function invalidate() { revision++; candidate = null; reviewed = false; status = ''; render() }
  for (const id of ['wb-baseline-profile', 'wb-baseline-source', 'wb-baseline-image']) $(id).onchange = invalidate
  $('wb-baseline-targets').oninput = invalidate
  $('wb-baseline-load').onclick = async () => {
    if (busy) return
    busy = true; status = t('baselineLoading'); render()
    try { profiles = await api('/api/workbench/baselines'); status = ''; candidate = null }
    catch (error) { status = error.message }
    finally { busy = false; render() }
  }
  $('wb-baseline-preview').onclick = async () => {
    if (busy) return
    const profileId = $('wb-baseline-profile').value, fromRun = $('wb-baseline-source').value === 'run'
    const sourceRunId = currentRun()?.id, evidenceName = $('wb-baseline-image').value
    const rawTargets = $('wb-baseline-targets').value.trim(), allowedTargetBuilds = rawTargets ? rawTargets.split(',').map(value => value.trim()) : undefined
    const currentRevision = ++revision
    busy = true; status = t('baselineLoading'); render()
    try {
      const next = await api('/api/workbench/baselines/candidate', { profileId, sourceKind: fromRun ? 'run' : 'project', ...(fromRun ? { runId: sourceRunId, evidenceName } : {}), ...(allowedTargetBuilds ? { allowedTargetBuilds } : {}) })
      if (currentRevision === revision) { candidate = { ...next, approvalRequestId: crypto.randomUUID() }; reviewed = false; status = t('baselineReady') }
    } catch (error) { if (currentRevision === revision) status = error.message }
    finally { busy = false; render() }
  }
  return {
    render,
    onRunChanged(run) {
      const next = `${run.id}:${[...(run.evidence ?? []), ...(run.steps ?? []).flatMap(step => step.evidence ?? [])].filter(file => file.contentType === 'image/png').map(file => file.name).join(',')}`
      if (next !== imageSignature) { imageSignature = next; render() }
    },
  }
}
