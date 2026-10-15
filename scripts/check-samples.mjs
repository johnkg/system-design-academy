// Verifies every code sample: JavaScript runs under Node, Python under python3, C# with `dotnet run <file>.cs`.
// Each sample must exit 0. For concepts and studies the JavaScript, Python and C# versions in one folder must also print
// identical output (design patterns are written idiomatically per language, so only their exit codes are checked).
// Usage: node scripts/check-samples.mjs [--no-compare] [slug ...]   (slugs filter by folder name)
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { cpus } from 'node:os';

const args = process.argv.slice(2);
const compare = !args.includes('--no-compare');
const only = args.filter((a) => !a.startsWith('--'));
const roots = ['patterns', 'concepts', 'studies'].map((c) => new URL(`../src/content/${c}/`, import.meta.url).pathname).filter((r) => existsSync(r));
const hasDotnet = spawnSync('dotnet', ['--version']).status === 0;
if (!hasDotnet) console.warn('! dotnet not found: C# samples will be skipped');

const env = { ...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1' };
const commands = {
  '.js': (f) => ['node', [f]],
  '.py': (f) => ['python3', ['-I', f]],
  '.cs': (f) => (hasDotnet ? ['dotnet', ['run', f]] : null),
};

const run = ([cmd, argv]) =>
  new Promise((resolve) => {
    const child = spawn(cmd, argv, { env });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 180_000);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    // `dotnet run` prints compiler hints and warnings on stdout, but only when it actually compiles (never on a cached run),
    // so drop those lines before comparing outputs.
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout: stdout.replace(/^.*\.cs\(\d+,\d+\): (info|warning) CS\d+:.*\n/gm, ''), stderr }); });
  });

// Collect one job per sample file, grouped by folder so outputs can be compared.
const groups = [];
for (const root of roots) for (const slug of readdirSync(root)) {
  if (only.length && !only.includes(slug)) continue;
  for (const dir of ['code', 'before']) {
    const d = join(root, slug, dir);
    if (!existsSync(d) || !statSync(d).isDirectory()) continue;
    const kind = root.split('/').slice(-2)[0];
    const label = `${kind}/${slug}/${dir}`;
    const files = [];
    for (const file of readdirSync(d)) {
      const ext = file.slice(file.lastIndexOf('.'));
      const cmd = commands[ext]?.(join(d, file));
      if (cmd === undefined) console.warn(`? no runner for ${label}/${file}`);
      else if (cmd) files.push({ file, cmd });
    }
    if (files.length) groups.push({ label, files, strict: kind !== 'patterns' });
  }
}

let failed = 0, ran = 0, mismatched = 0;
const queue = groups.flatMap((g) => g.files.map((f) => ({ g, ...f })));
const workers = Math.max(2, Math.min(cpus().length, 6));
await Promise.all(Array.from({ length: workers }, async () => {
  for (let job; (job = queue.shift()); ) {
    const res = await run(job.cmd);
    ran++;
    job.g.results = { ...job.g.results, [job.file]: res };
    if (res.status === 0) console.log(`ok   ${job.g.label}/${job.file}`);
    else { failed++; console.error(`FAIL ${job.g.label}/${job.file}\n${res.stdout}${res.stderr}`); }
  }
}));

if (compare) {
  for (const g of groups.filter((x) => x.strict)) {
    const outs = Object.entries(g.results ?? {}).filter(([, r]) => r.status === 0).map(([f, r]) => [f, r.stdout]);
    const lang = outs.filter(([f]) => /^(javascript\.js|python\.py|csharp\.cs)$/.test(f));
    if (lang.length > 1 && lang.some(([, o]) => o !== lang[0][1])) {
      mismatched++;
      console.error(`DIFF ${g.label}: ${lang.map(([f, o]) => `${f} (${o.length} chars)`).join(' vs ')} print different output`);
    }
  }
}

console.log(`${ran - failed}/${ran} samples passed${compare ? `, ${mismatched} folder(s) with differing output` : ''}`);
process.exit(failed || mismatched ? 1 : 0);
