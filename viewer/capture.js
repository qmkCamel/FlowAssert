export let viewerCapture

/** Local exports of the displayed phone surface; never dispatch device commands. */
export function createViewerCapture(t) {
  const screenshot = document.querySelector('#capture-screenshot')
  const record = document.querySelector('#capture-record')
  const timer = document.querySelector('#capture-timer')
  const message = document.querySelector('#capture-message')
  const links = { screenshot: document.querySelector('#capture-png'), recording: document.querySelector('#capture-video') }
  const results = new Map()
  let session = null, surface = null, ownedSurface = false, busy = false, active = null, notice = 'hint', sequence = 0
  let decodedImage = null
  const mime = typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function'
    ? ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((type) => MediaRecorder.isTypeSupported(type)) : null

  function dimensions() {
    if (!session || !surface || surface.hidden) return null
    const width = surface.displayWidth ?? surface.naturalWidth ?? surface.width, height = surface.displayHeight ?? surface.naturalHeight ?? surface.height
    return width > 0 && height > 0 && width * height <= 32_000_000 ? { width, height } : null
  }
  function render() {
    screenshot.disabled = busy || !dimensions()
    screenshot.textContent = t(busy ? 'capture.capturing' : 'capture.screenshot')
    record.disabled = active ? active.stopping : !dimensions() || !mime
    record.textContent = t(active?.stopping ? 'capture.finishing' : active ? 'capture.stop' : 'capture.start')
    record.setAttribute('aria-pressed', String(Boolean(active)))
    timer.hidden = !active
    const seconds = active ? Math.floor((performance.now() - active.started) / 1000) : 0
    timer.textContent = `● ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    message.textContent = t(`capture.${!mime && notice === 'hint' ? 'unsupported' : notice}`)
    for (const [kind, link] of Object.entries(links)) {
      const result = results.get(kind)
      link.hidden = !result
      link.textContent = t(kind === 'screenshot' ? 'capture.downloadPng' : result?.partial ? 'capture.downloadPartial' : 'capture.downloadVideo')
    }
  }
  function save(kind, blob, extension, partial = false, download = true) {
    if (!blob?.size) throw new Error('Empty capture')
    const url = URL.createObjectURL(blob)
    const link = links[kind]
    const old = results.get(kind)
    results.set(kind, { url, partial })
    link.href = url
    link.download = `mobile-mirror-${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}-${++sequence}.${extension}`
    render()
    // A persistent visible link remains when a browser blocks automatic downloads.
    try { if (download) link.click() } catch { /* the user can use the link */ }
    if (old) URL.revokeObjectURL(old.url)
  }
  screenshot.addEventListener('click', async () => {
    if (busy || !session || !surface) return
    const captureSession = session
    busy = true; render()
    try {
      // Polling can replace an image source between button readiness and click.
      // Wait for that same session's decode gap rather than silently dropping the action.
      const deadline = performance.now() + 1000
      let size = dimensions()
      while (!size && session === captureSession && performance.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 16)); size = dimensions()
      }
      if (!size || session !== captureSession) throw new Error('Capture frame unavailable')
      const canvas = document.createElement('canvas')
      canvas.width = size.width; canvas.height = size.height
      canvas.getContext('2d').drawImage(surface, 0, 0)
      const blob = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('PNG encoding timed out')), 10000)
        canvas.toBlob((value) => { clearTimeout(timeout); value ? resolve(value) : reject(new Error('PNG encoding failed')) }, 'image/png')
      })
      save('screenshot', blob, 'png'); notice = 'pngSaved'
    } catch { notice = 'screenshotFailed' }
    finally { busy = false; render() }
  })

  function draw(recording) {
    const size = dimensions()
    if (recording.session !== session) return false
    // Image source replacement briefly clears naturalWidth; retain the last
    // encoded frame during that decode gap instead of ending the recording.
    if (!size) return true
    const { canvas, context } = recording
    const scale = Math.min(canvas.width / size.width, canvas.height / size.height)
    context.fillStyle = '#000'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(surface, (canvas.width - size.width * scale) / 2, (canvas.height - size.height * scale) / 2, size.width * scale, size.height * scale)
    return true
  }
  function dispose(recording) {
    cancelAnimationFrame(recording.raf)
    clearInterval(recording.tick)
    for (const track of recording.stream.getTracks()) track.stop()
  }
  function finish(recording) {
    if (recording.finished) return
    recording.finished = true; dispose(recording)
    if (active === recording) active = null
    try {
      const type = recording.recorder.mimeType || mime
      const blob = new Blob(recording.chunks, { type })
      const partial = recording.partial || (recording.managed && recording.reason !== 'run-finished')
      save('recording', blob, type.includes('mp4') ? 'mp4' : 'webm', partial, !recording.managed)
      recording.resolve({ blob, durationMs: recording.durationMs, reason: recording.partial ? 'partial' : recording.reason, partial })
      notice = recording.partial ? 'partial' : recording.reason === 'run-finished' ? 'videoSaved' : recording.reason || 'videoSaved'
    } catch { notice = 'recordFailed'; recording.resolve({ blob: null, reason: 'partial', partial: true, durationMs: recording.durationMs }) }
    recording.chunks = []; render()
  }
  function stop(reason = 'videoSaved') {
    const recording = active
    if (!recording || recording.stopping) return
    recording.stopping = true; recording.reason = reason
    recording.durationMs = Math.max(1, Math.round(performance.now() - recording.started))
    cancelAnimationFrame(recording.raf); clearInterval(recording.tick)
    render()
    try {
      if (recording.recorder.state !== 'inactive') recording.recorder.stop()
      // Even an inactive recorder queues its final dataavailable before stop.
    } catch { recording.partial = true; finish(recording) }
  }
  function startRecording(managed = false) {
    if (active) throw new Error(t('capture.busy'))
    const size = dimensions()
    if (!size || !mime) throw new Error(t('capture.unavailable'))
    let stream
    try {
      const canvas = document.createElement('canvas')
      const scale = Math.min(1, 1920 / Math.max(size.width, size.height))
      canvas.width = Math.max(2, Math.round(size.width * scale / 2) * 2)
      canvas.height = Math.max(2, Math.round(size.height * scale / 2) * 2)
      stream = canvas.captureStream(30)
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 })
      let resolve
      const done = new Promise((finish) => { resolve = finish })
      const startedAt = new Date().toISOString()
      const recording = { managed, resolve, startedAt, durationMs: 0, canvas, context: canvas.getContext('2d'), stream, recorder, session, started: performance.now(), chunks: [], bytes: 0, stopping: false, partial: false, finished: false, raf: 0, tick: null }
      active = recording
      recorder.ondataavailable = (event) => {
        if (event.data.size) { recording.chunks.push(event.data); recording.bytes += event.data.size }
        if (recording.bytes >= 128 * 1024 * 1024) stop('limit')
      }
      recorder.onstop = () => finish(recording)
      recorder.onerror = () => { recording.partial = true; stop('partial') }
      draw(recording)
      recorder.start(1000)
      const paint = () => {
        if (active !== recording || recording.stopping) return
        try { if (!draw(recording)) { stop('disconnected'); return } }
        catch { recording.partial = true; stop('partial'); return }
        recording.raf = requestAnimationFrame(paint)
      }
      recording.raf = requestAnimationFrame(paint)
      recording.tick = setInterval(() => {
        if (performance.now() - recording.started >= 600000) stop('limit')
        render()
      }, 200)
      notice = 'recording'; render()
      return { sessionId: session, startedAt, done, stop: (reason) => { if (active === recording) stop(reason) } }
    } catch {
      if (active) dispose(active)
      active = null; stream?.getTracks().forEach((track) => track.stop())
      notice = 'recordFailed'; render()
      if (managed) throw new Error(t('capture.recordFailed'))
    }
  }
  record.addEventListener('click', () => { if (active) stop(); else { try { startRecording() } catch { notice = 'recordFailed'; render() } } })
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop('hidden') })
  window.addEventListener('pagehide', () => { stop('hidden'); if (ownedSurface) surface.close(); ownedSurface = false; surface = null })
  window.addEventListener('beforeunload', (event) => {
    if (active) { event.preventDefault(); event.returnValue = '' }
  })
  render()
  return viewerCapture = {
    beginRun: () => startRecording(true),
    render,
    stop,
    setSession(value) {
      if (session !== value) { stop('disconnected'); if (ownedSurface) surface.close(); ownedSurface = false; surface = null; decodedImage = null; session = value }
      render()
    },
    frame(element, value) {
      if (!session || value !== session) return
      // Polling reuses one <img>: assigning its next src clears naturalWidth
      // before onload. Keep a decoded copy so a click during that gap is not lost.
      let next = element
      if (element instanceof HTMLImageElement) {
        const width = element.naturalWidth, height = element.naturalHeight
        if (!width || !height || width * height > 32_000_000) return
        const canvas = decodedImage?.width === width && decodedImage.height === height ? decodedImage : document.createElement('canvas')
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
        try { const context = canvas.getContext('2d'); context.clearRect(0, 0, width, height); context.drawImage(element, 0, 0) }
        catch { return }
        decodedImage = canvas; next = canvas
      }
      if (ownedSurface) surface.close()
      ownedSurface = false; surface = next; render()
    },
    videoFrame(frame, value, fallback) {
      if (!session || value !== session) return
      const first = !surface || !ownedSurface
      const next = typeof frame.clone === 'function' ? frame.clone() : fallback
      if (ownedSurface) surface.close()
      ownedSurface = next !== fallback; surface = next
      if (first) render()
    },
  }
}
