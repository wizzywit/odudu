import { pruneCache } from '#/prune';

const [cacheDir = '.turbo/cache', summaryDir = '.turbo/runs'] = process.argv.slice(2);
const { kept, removed } = await pruneCache(cacheDir, summaryDir);
console.log(`turbo cache: kept ${String(kept)} entries, removed ${String(removed)}`);
