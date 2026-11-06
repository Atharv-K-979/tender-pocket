// node --import ./register.mjs : maps `k6`, `k6/*` imports to local shims and defines k6 globals.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
register('./hooks.mjs', import.meta.url);
globalThis.__ENV = process.env;
globalThis.open = (path, mode) => (mode === 'b' ? readFileSync(path) : readFileSync(path, 'utf8'));
