// Read-only sequencing. Loading and rendering belong to the evidence owner.
export function createScreenshotPlayback({ load, change, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let steps = [], failures = new Set(), position = -1, enabled = false, speed = 1
  let active = false, ready = false, loading = false, reason = 'paused', timer, request, generation = 0
  const state = () => ({ position, total: steps.length, step: steps[position], enabled, speed, active, ready, loading, reason })
  const emit = () => change(state())
  const clear = () => { clearTimer(timer); timer = undefined }
  function cancel() { clear(); generation++; request?.abort(); request = undefined; loading = false }
  function pause(cause = 'paused') { if (loading) cancel(); else clear(); active = false; reason = cause; emit() }
  function schedule() {
    clear()
    if (!active || !ready) return
    timer = setTimer(() => {
      if (position === steps.length - 1) { pause('ended'); return }
      void select(position + 1, true)
    }, 1500 / speed)
  }
  async function select(next, automatic = false, acknowledged = false) {
    cancel(); position = next; ready = false; reason = 'paused'
    if (!automatic) active = false
    if (!steps[position]) { emit(); return }
    loading = true; const token = generation, controller = new AbortController(); request = controller; emit()
    try {
      const available = await load(steps[position], { signal: controller.signal, automatic })
      if (token !== generation || controller.signal.aborted) return
      loading = false; ready = available
      if (!available) { active = false; reason = 'unavailable' }
      else if (active && failures.has(steps[position].index) && !acknowledged) { active = false; reason = 'failure' }
      else if (active) { reason = 'playing'; schedule() }
      emit()
    } catch (error) {
      if (token !== generation || controller.signal.aborted) return
      loading = false; active = false; ready = false; reason = 'unavailable'; emit()
    }
  }
  function play() {
    if (!enabled || position < 0 || reason === 'unavailable') return
    const acknowledged = reason === 'failure'
    active = true
    if (reason === 'ended') { void select(0, true); return }
    if (!ready) { void select(position, true, acknowledged); return }
    if (failures.has(steps[position].index) && !acknowledged) { pause('failure'); return }
    reason = 'playing'; schedule(); emit()
  }
  return {
    state, play, pause,
    configure(options) {
      cancel(); steps = options.steps; failures = new Set(options.failures); enabled = options.enabled && steps.length > 1
      active = false; speed = 1; return select(steps.findIndex(step => step.index === options.index))
    },
    select: index => select(steps.findIndex(step => step.index === index)),
    retry: () => select(position),
    speed(value) { if (![.5, 1, 2].includes(value)) return; speed = value; schedule(); emit() },
  }
}
