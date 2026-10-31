// `--shard 2/5` runs only every 5th page starting at the 2nd, so CI can split the browser checks over parallel jobs.
// Pages are dealt out round-robin (not in blocks) so every shard gets a similar mix of slow and fast pages.
export function parseShard(args) {
  const i = args.indexOf('--shard');
  if (i < 0) return { active: false, pick: (list) => list };
  const m = /^(\d+)\/(\d+)$/.exec(args[i + 1] ?? '');
  const index = m ? Number(m[1]) : 0, count = m ? Number(m[2]) : 0;
  if (!m || index < 1 || index > count) {
    console.error(`--shard needs the form index/count with 1 <= index <= count (got "${args[i + 1] ?? ''}")`);
    process.exit(2);
  }
  return { active: true, index, count, pick: (list) => list.filter((_, n) => n % count === index - 1) };
}
