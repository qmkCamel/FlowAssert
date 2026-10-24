export function createRetentionPanel({ $, t, node, api, onRefresh }) {
let retentionSnapshot = null, retentionPlan = null, retentionBusy = false, retentionStatus = '', retentionStale = false, retentionController = null, retentionRevision = 0, retentionUpdatedAt = null
function renderRetention() {
  $('wb-retention-scan').disabled = retentionBusy
  $('wb-retention-plan').disabled = retentionBusy
  $('wb-retention-cancel').hidden = !retentionController
  $('wb-retention-status').textContent = retentionStatus || (retentionUpdatedAt ? `${t('retentionUpdated')} · ${retentionUpdatedAt.toLocaleString()}` : t('retentionEmpty'))
  const root = $('wb-retention-results'); root.replaceChildren()
  if (retentionSnapshot) root.append(node('p', `${t('retentionLive')}: ${Math.round(retentionSnapshot.liveBytes / 1024)} KiB · ${t('retentionTrash')}: ${Math.round(retentionSnapshot.trashBytes / 1024)} KiB · ${retentionSnapshot.runs.length} ${t('retentionRuns')}`, 'wb-note'))
  if (retentionSnapshot?.categories) root.append(node('p', `${t('retentionExports')}: ${Math.round(retentionSnapshot.categories.exports / 1024)} KiB · ${t('retentionBaselines')}: ${Math.round(retentionSnapshot.categories.baselines / 1024)} KiB · ${t('retentionIndexes')}: ${Math.round(retentionSnapshot.categories.indexes / 1024)} KiB · ${t('retentionScanCoverage')}: ${retentionSnapshot.scan.entries}`, 'wb-note'))
  if (retentionPlan) {
    const preview = node('details'); preview.open = true
    preview.append(node('summary', `${t('retentionCandidates')}: ${retentionPlan.candidates.length} · ${Math.round(retentionPlan.movableBytes / 1024)} KiB`))
    preview.append(node('p', `${t('retentionNoFree')} · ${t('retentionExpiry')}: ${retentionPlan.expiresAt}`, 'wb-scope'))
    for (const item of retentionPlan.candidates) preview.append(node('p', `${item.id} · ${Math.round(item.bytes / 1024)} KiB`, 'wb-note'))
    preview.append(node('p', `${t('retentionProtected')}: ${retentionPlan.protected.length}`, 'wb-note'))
    for (const item of retentionPlan.protected.slice(0, 50)) preview.append(node('p', `${item.id} · ${item.reasons.join(', ')}`, 'wb-note'))
    const checked = node('input'); checked.type = 'checkbox'; checked.disabled = retentionBusy || retentionStale || !retentionPlan.candidates.length
    const label = node('label'); label.append(checked, document.createTextNode(` ${t('retentionReviewed')}`))
    const confirm = node('button', t('retentionMove'), 'check-button'); confirm.type = 'button'; confirm.disabled = true
    checked.onchange = () => { confirm.disabled = !checked.checked || retentionBusy || retentionStale }
    confirm.onclick = async () => {
      retentionBusy = true; retentionStatus = t('retentionMoving'); renderRetention()
      try { const result = await api('/api/workbench/retention/confirm', { plan: retentionPlan, reviewed: true }); retentionPlan = null; retentionSnapshot = await api('/api/workbench/retention'); retentionUpdatedAt = new Date(); retentionStatus = `${t('retentionMoved')}: ${result.moved.length}${result.failed?.length ? ` · failed: ${result.failed.map(item => `${item.id} (${item.reason})`).join(', ')}` : ''}${result.pending?.length ? ` · pending: ${result.pending.join(', ')}` : ''}`; await onRefresh() }
      catch (error) { retentionStatus = error.message; retentionStale = true; try { retentionSnapshot = await api('/api/workbench/retention') } catch { /* preserve last usable snapshot */ } }
      finally { retentionBusy = false; renderRetention() }
    }
    preview.append(label, confirm); root.append(preview)
  }
  if (retentionSnapshot?.trash.length) {
    const trash = node('details'); trash.append(node('summary', `${t('retentionTrash')}: ${retentionSnapshot.trash.length}`))
    for (const item of retentionSnapshot.trash) {
      const row = node('div', undefined, 'wb-row'); row.append(node('span', `${item.id} · ${Math.round(item.bytes / 1024)} KiB · ${item.state}`))
      const restore = node('button', t('retentionRestore'), 'text-button'); restore.type = 'button'; restore.disabled = retentionBusy
      restore.onclick = async () => { retentionBusy = true; retentionStatus = t('retentionRestoring'); renderRetention(); try { await api('/api/workbench/retention/restore', { runId: item.id }); retentionSnapshot = await api('/api/workbench/retention'); retentionUpdatedAt = new Date(); retentionStatus = t('retentionRestored'); await onRefresh() } catch (error) { retentionStatus = error.message; try { retentionSnapshot = await api('/api/workbench/retention') } catch { /* preserve last usable snapshot */ } } finally { retentionBusy = false; renderRetention() } }
      const purge = node('details'), phrase = node('input'), irreversible = node('button', t('retentionPurge'), 'check-button')
      phrase.type = 'text'; phrase.placeholder = `PURGE ${item.id}`; phrase.setAttribute('aria-label', `${t('retentionPurge')} ${item.id}`)
      irreversible.type = 'button'; irreversible.disabled = true; phrase.oninput = () => { irreversible.disabled = phrase.value !== `PURGE ${item.id}` || retentionBusy }
      irreversible.onclick = async () => { retentionBusy = true; retentionStatus = t('retentionPurging'); renderRetention(); try { const result = await api('/api/workbench/retention/purge', { runId: item.id, confirmPhrase: `PURGE ${item.id}` }); retentionSnapshot = await api('/api/workbench/retention'); retentionUpdatedAt = new Date(); retentionStatus = `${t('retentionFreed')}: ${result.freedBytes} B` } catch (error) { retentionStatus = error.message; try { retentionSnapshot = await api('/api/workbench/retention') } catch { /* preserve last usable snapshot */ } } finally { retentionBusy = false; renderRetention() } }
      purge.append(node('summary', t('retentionPurge')), node('p', t('retentionIrreversible'), 'wb-warning'), phrase, irreversible)
      row.append(restore, purge); trash.append(row)
    }
    root.append(trash)
  }
}
$('wb-retention-scan').onclick = async () => {
  const revision = ++retentionRevision, controller = new AbortController(); retentionController = controller; retentionBusy = true; retentionStatus = t('retentionScanning'); renderRetention()
  try { const snapshot = await api('/api/workbench/retention', undefined, controller.signal); if (revision !== retentionRevision) return; retentionSnapshot = snapshot; retentionUpdatedAt = new Date(); retentionStatus = ''; if (retentionPlan?.generation !== snapshot.generation) retentionStale = true }
  catch (error) { if (revision === retentionRevision && error.name !== 'AbortError') retentionStatus = error.message }
  finally { if (revision === retentionRevision) { retentionController = null; retentionBusy = false; renderRetention() } }
}
$('wb-retention-plan').onclick = async () => {
  const revision = ++retentionRevision, controller = new AbortController(); retentionController = controller; retentionBusy = true; retentionStatus = t('retentionScanning'); renderRetention()
  try {
    const plan = await api('/api/workbench/retention/plan', { olderThanDays: Number($('wb-retention-days').value), maxRuns: Number($('wb-retention-max').value) }, controller.signal)
    if (revision !== retentionRevision) return
    retentionPlan = plan; retentionStale = false; retentionStatus = t('retentionPlanReady')
  } catch (error) { if (revision === retentionRevision && error.name !== 'AbortError') retentionStatus = error.message }
  finally { if (revision === retentionRevision) { retentionController = null; retentionBusy = false; renderRetention() } }
}
$('wb-retention-cancel').onclick = () => { retentionRevision++; retentionController?.abort(); retentionController = null; retentionBusy = false; retentionStatus = t('retentionCancelled'); renderRetention() }
return {
  render: renderRetention,
  isPinned(runId) { return retentionSnapshot?.runs.find(item => item.id === runId)?.protectedBy.includes('pin') ?? false },
  async togglePin(runId, pinned) {
    await api('/api/workbench/retention/pin', { runId, pinned })
    retentionSnapshot = await api('/api/workbench/retention')
    retentionPlan = null
    renderRetention()
  },
}
}
