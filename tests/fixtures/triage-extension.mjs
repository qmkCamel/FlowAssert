export async function analyzeTriage(run, comparison, refs, digest, config = {}) {
  if (config.mode === 'hang') await new Promise(() => {})
  if (config.mode === 'busy') { for (;;) {} }
  if (config.mode === 'exit') process.exit(0)
  if (config.mode === 'invalid') return { arbitrary: true }
  if (config.delay) await new Promise(resolve => setTimeout(resolve, config.delay))
  return {
    // Deliberately incorrect: the core must replace these with the recorded projection.
    reportedVerdict: 'pass', effectiveVerdict: 'pass',
    verification: { ui: 'pass', business: 'pass', visual: 'pass', cleanup: 'pass', evidence: 'pass' },
    facts: [], routes: [], disposition: 'unknown', limitations: ['extension-fixture'],
    omitted: { facts: 0, evidence: 0 }, state: 'complete',
  }
}
