// Verifies every code sample: JavaScript runs under Node, C# runs with `dotnet run <file>.cs`.
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['patterns', 'concepts', 'studies'].map((c) => new URL(`../src/content/${c}/`, import.meta.url).pathname).filter((r) => existsSync(r));
const hasDotnet = spawnSync('dotnet', ['--version']).status === 0;
if (!hasDotnet) console.warn('! dotnet not found: C# samples will be skipped');

const runners = {
  '.js': (f) => spawnSync('node', [f], { encoding: 'utf8' }),
  '.cs': (f) => (hasDotnet ? spawnSync('dotnet', ['run', f], { encoding: 'utf8', env: { ...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1' } }) : null),
};

let failed = 0, ran = 0;
for (const root of roots) for (const slug of readdirSync(root)) {
  for (const dir of ['code', 'before']) {
    const d = join(root, slug, dir);
    if (!existsSync(d) || !statSync(d).isDirectory()) continue;
    for (const file of readdirSync(d)) {
      const ext = file.slice(file.lastIndexOf('.'));
      const run = runners[ext];
      if (!run) { console.warn(`? no runner for ${slug}/${dir}/${file}`); continue; }
      const res = run(join(d, file));
      if (!res) continue;
      ran++;
      if (res.status === 0) console.log(`ok   ${root.split('/').slice(-2)[0]}/${slug}/${dir}/${file}`);
      else { failed++; console.error(`FAIL ${slug}/${dir}/${file}\n${res.stdout}${res.stderr}`); }
    }
  }
}
console.log(`${ran - failed}/${ran} samples passed`);
process.exit(failed ? 1 : 0);
