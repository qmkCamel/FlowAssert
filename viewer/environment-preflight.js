/** Local diagnostics only. Reports never authorize a test, device action or host command. */
export function createEnvironmentPreflight(t) {
  const root = document.querySelector('#environment-preflight')
  if (!root) return
  const operation = root.querySelector('#preflight-operation'), testRef = root.querySelector('#preflight-test-ref')
  const check = root.querySelector('#preflight-check'), cancel = root.querySelector('#preflight-cancel')
  const progress = root.querySelector('#preflight-progress'), error = root.querySelector('#preflight-error')
  const result = root.querySelector('#preflight-result'), stale = root.querySelector('#preflight-stale')
  let controller = null, generation = 0, lastReport = null
  function pending(value) { check.disabled = value; cancel.hidden = !value; progress.hidden = !value }
  function invalidate() {
    generation++; controller?.abort(); controller = null; pending(false)
    stale.hidden = !lastReport
    root.querySelector('#preflight-test-row').hidden = operation.value !== 'test'
    root.querySelector('#preflight-features').hidden = !['mock', 'test'].includes(operation.value)
  }
  root.addEventListener('change', invalidate)
  testRef.addEventListener('input', invalidate)
  cancel.addEventListener('click', invalidate)
  check.addEventListener('click', async () => {
    if (controller) return
    const current = ++generation, request = new AbortController(); controller = request
    const context = { operation: operation.value }
    if (operation.value === 'test') context.testRef = testRef.value
    if (['mock', 'test'].includes(operation.value)) context.features = Object.fromEntries([...root.querySelectorAll('[data-preflight-feature]')].map(input => [input.dataset.preflightFeature, input.value]))
    const recordingSupported = typeof MediaRecorder === 'function' && typeof HTMLCanvasElement.prototype.captureStream === 'function'
      && ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].some(type => MediaRecorder.isTypeSupported(type))
    pending(true); error.hidden = true
    try {
      const response = await fetch('/api/environment-preflight', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context, recordingSupported }), signal: request.signal })
      if (!response.ok) throw new Error('unavailable')
      const report = await response.json()
      if (current !== generation || request.signal.aborted) return
      if (report.schemaVersion !== 2 || !Array.isArray(report.checks)) throw new Error('invalid')
      lastReport = report
      const heading = document.createElement('p'); heading.textContent = `${report.context.entry} / ${report.context.operation} / ${report.context.platform}: ${report.overall} · ${report.checkedAt}`
      const list = document.createElement('ul')
      for (const item of report.checks) { const row = document.createElement('li'); row.textContent = `${item.id}: ${item.status} · ${item.code}`; list.append(row) }
      result.replaceChildren(heading, list); stale.hidden = true
    } catch {
      if (current === generation && !request.signal.aborted) { error.textContent = t('preflight.error'); error.hidden = false; stale.hidden = !lastReport }
    } finally { if (current === generation) { controller = null; pending(false) } }
  })
  window.addEventListener('pagehide', invalidate)
  return { invalidate }
}
