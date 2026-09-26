import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

export interface PruneResult {
  kept: number;
  removed: number;
}

const ENTRY = /^(?<hash>[0-9a-f]+)(?:\.tar\.zst|-meta\.json|-manifest\.json)(?:\.tmp)?$/u;

async function hashesNamedIn(summaryDir: string): Promise<Set<string>> {
  const files = (await readdir(summaryDir)).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    throw new Error(`no Turborepo run summary in ${summaryDir}; refusing to prune the cache`);
  }
  const hashes = new Set<string>();
  for (const file of files) {
    const summary: unknown = JSON.parse(await readFile(join(summaryDir, file), 'utf8'));
    const tasks: unknown = (summary as { tasks?: unknown }).tasks;
    if (!Array.isArray(tasks)) throw new Error(`${join(summaryDir, file)}: no task list`);
    for (const task of tasks as unknown[]) {
      const hash: unknown = (task as { hash?: unknown }).hash;
      if (typeof hash === 'string') hashes.add(hash);
    }
  }
  return hashes;
}

// Removes every cache entry that no run summary in `summaryDir` names, so a
// cache restored from an earlier run and saved again holds only what this
// run read or wrote instead of the union of every run before it.
export async function pruneCache(cacheDir: string, summaryDir: string): Promise<PruneResult> {
  const live = await hashesNamedIn(summaryDir);
  const kept = new Set<string>();
  const removed = new Set<string>();
  for (const file of await readdir(cacheDir)) {
    const hash = ENTRY.exec(file)?.groups?.hash;
    if (hash === undefined) continue;
    if (live.has(hash)) {
      kept.add(hash);
      continue;
    }
    removed.add(hash);
    await rm(join(cacheDir, file), { force: true });
  }
  return { kept: kept.size, removed: removed.size };
}
