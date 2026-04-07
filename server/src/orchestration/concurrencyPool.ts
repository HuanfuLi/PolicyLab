/**
 * C4: Concurrency pool — run async tasks with bounded parallelism (spec §9).
 */

/**
 * Run all tasks with at most `limit` running concurrently.
 * Returns results in the same order as the input tasks array.
 */
interface ConcurrencyOptions {
  shouldContinue?: () => boolean;
}

export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
  options: ConcurrencyOptions = {},
): Promise<T[]> {
  if (tasks.length === 0) return [];

  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  const shouldContinue = options.shouldContinue ?? (() => true);

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      if (!shouldContinue()) return;
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
