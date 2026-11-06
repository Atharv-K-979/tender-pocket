// Static check: every named import from a local k6 module is exported by that module.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const K6 = resolve(dirname(fileURLToPath(import.meta.url)), '../../k6');
const files = ['main.js', ...readdirSync(join(K6, 'lib')).map((f) => `lib/${f}`), ...readdirSync(join(K6, 'screens')).map((f) => `screens/${f}`)]
  .filter((f) => f.endsWith('.js'));
const exportsOf = (src) => new Set([...src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
let bad = 0;
for (const f of files) {
  const src = readFileSync(join(K6, f), 'utf8');
  for (const m of src.matchAll(/import\s+(?:\*\s+as\s+(\w+)|\{([^}]*)\})\s+from\s+'(\.[^']+)'/g)) {
    const target = resolve(dirname(join(K6, f)), m[3]);
    const ex = exportsOf(readFileSync(target, 'utf8'));
    if (m[1]) {
      for (const use of src.matchAll(new RegExp(`(?<![/\\w.])${m[1]}\\.(\\w+)`, "g"))) {
        if (!ex.has(use[1])) { console.error(`${f}: ${m[1]}.${use[1]} not exported by ${m[3]}`); bad += 1; }
      }
      continue;
    }
    for (const name of m[2].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      if (!ex.has(name)) { console.error(`${f}: '${name}' not exported by ${m[3]}`); bad += 1; }
    }
  }
}
if (bad) { console.error(`${bad} unresolved imports`); process.exit(1); }
console.log(`imports ok across ${files.length} files`);
