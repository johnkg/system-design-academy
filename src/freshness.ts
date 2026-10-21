// Dates for pages, read from git history at build time: when each page was added and last changed.
// CI checks out the full history for this. Without git history (a zip download, a shallow clone) the maps are empty and the
// pages that use them simply show less, so a build never fails because of it.
import { execFileSync } from 'node:child_process';

export interface Dates { added: Map<string, string>; updated: Map<string, string> }
let cache: Dates | null = null;

function parse(log: string, keepFirst: boolean) {
  const out = new Map<string, string>();
  let date = '';
  for (const line of log.split('\n')) {
    if (line.startsWith('@')) date = line.slice(1);
    else if (line && date && (!keepFirst || !out.has(line))) out.set(line, date); // newest first: keep the first date seen, or overwrite to end on the oldest
  }
  return out;
}

export function pageDates(): Dates {
  if (cache) return cache;
  const MAX_GIT_OUTPUT = 64 * 1024 * 1024; // bytes: the full history of src/content is a few MB, so this leaves ample room
  const run = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: MAX_GIT_OUTPUT, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const updated = parse(run(['log', '--format=@%cs', '--name-only', '--no-renames', '--', 'src/content']), true);
    const added = parse(run(['log', '--diff-filter=A', '--format=@%cs', '--name-only', '--no-renames', '--', 'src/content']), false);
    cache = { added, updated };
  } catch {
    cache = { added: new Map(), updated: new Map() };
  }
  return cache;
}

/** Path of a page's data file, the key used by pageDates(). */
export const metaPath = (collection: 'concepts' | 'patterns' | 'studies', slug: string) => `src/content/${collection}/${slug}/meta.json`;
