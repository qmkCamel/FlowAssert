/** Run every cleanup in dependency order, preserving all failures for the caller. */
export async function closeInOrder(steps: readonly (() => void | Promise<void>)[]): Promise<void> {
  const errors: unknown[] = []
  for (const step of steps) {
    try { await step() } catch (error) { errors.push(error) }
  }
  if (errors.length) throw new AggregateError(errors, 'Runtime cleanup failed')
}
