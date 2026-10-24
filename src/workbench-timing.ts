export type TimingPhase = 'geometry' | 'locate' | 'action' | 'png' | 'xml' | 'persist' | 'verify'
export interface RunTiming { phase: TimingPhase; step?: number; startedAt: string; durationMs: number; ok: boolean }
export interface TimingObserver { start(phase: TimingPhase): void; end(timing: RunTiming): void }
export async function timed<T>(observer: TimingObserver | undefined, phase: TimingPhase, operation: () => Promise<T>): Promise<T> {
  const startedAt = new Date().toISOString(), start = performance.now()
  observer?.start(phase)
  let ok = false
  try { const result = await operation(); ok = true; return result }
  finally { observer?.end({ phase, startedAt, durationMs: Math.round((performance.now() - start) * 100) / 100, ok }) }
}
