/** Diagnostic-only exit history parser. It never emits an attributed health-pass witness. */
export function parseAndroidExitHistory(text: string): { schemaVersion: 1; records: { reason: 'crash' | 'anr' | 'normal-exit' | 'other'; attributed: false }[]; truncated: boolean } {
  if (Buffer.byteLength(text) > 1024 * 1024) return { schemaVersion: 1, records: [], truncated: true }
  const records: { reason: 'crash' | 'anr' | 'normal-exit' | 'other'; attributed: false }[] = []
  for (const line of text.split('\n')) {
    const match = /^\s*reason=\d+\s+\((CRASH|CRASH NATIVE|ANR|EXIT SELF|USER REQUESTED|[A-Z ]+)\)\s*$/.exec(line)
    if (!match) continue
    if (records.length >= 256) return { schemaVersion: 1, records, truncated: true }
    records.push({ reason: match[1] === 'ANR' ? 'anr' : match[1] === 'CRASH' || match[1] === 'CRASH NATIVE' ? 'crash'
      : match[1] === 'EXIT SELF' || match[1] === 'USER REQUESTED' ? 'normal-exit' : 'other', attributed: false })
  }
  return { schemaVersion: 1, records, truncated: false }
}
