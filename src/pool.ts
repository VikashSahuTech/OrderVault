/**
 * Runs `work` over `items` with at most `limit` running at the same time.
 * Results keep the order of `items`. The first error stops new work and is rethrown.
 */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
  onDone?: (done: number) => void
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  let done = 0
  let failed = false
  let failure: unknown
  const runner = async () => {
    while (!failed) {
      const i = next++
      if (i >= items.length) return
      try {
        results[i] = await work(items[i], i)
      } catch (e) {
        if (!failed) { failed = true; failure = e }
        return
      }
      done += 1
      onDone?.(done)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, runner))
  if (failed) throw failure
  return results
}
