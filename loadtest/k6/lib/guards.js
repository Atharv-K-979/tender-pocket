// Safety guards (pure module, unit-tested in node). Same semantics as common/safety.py.
//   matchDeny      — G3 endpoint deny-list (pattern "*" = any characters, trailing "*" = prefix)
//   checkOrigin    — G3 all traffic to the Next.js frontend origin; blocked ports (8090)
//   assertVuTotal  — G1 exactly 17 VUs in BENCHMARK (browser VUs included)
//   isEc21         — G2 target host / resolved IPs vs the EC2-1 deny-list

function globToRegex(glob) {
  const esc = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${esc}$`);
}

function stripPath(path) {
  let p = String(path);
  const m = p.match(/^[a-z]+:\/\/[^/]+(\/.*)?$/i);
  if (m) p = m[1] || '/';
  p = p.split('?')[0].split('#')[0];
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p || '/';
}

export function matchDeny(path, patterns) {
  const p = stripPath(path);
  for (const raw of patterns || []) {
    const pat = String(raw).replace(/\/+$/, '');
    if (pat.endsWith('*')) {
      const prefix = pat.slice(0, -1);
      if (prefix.includes('*')) {
        const re = globToRegex(pat);
        if (re.test(p) || re.test(`${p}/`)) return raw;
      } else if (p.startsWith(prefix) || `${p}/`.startsWith(prefix)) {
        return raw;
      }
    } else if (pat.includes('*')) {
      if (globToRegex(pat).test(p)) return raw;
    } else if (p === pat) {
      return raw;
    }
  }
  return null;
}

export function parseOrigin(url) {
  const m = String(url).match(/^([a-z]+):\/\/([^/:?#]+)(?::(\d+))?/i);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const port = m[3] ? Number(m[3]) : (scheme === 'https' ? 443 : 80);
  return { scheme, host: m[2].toLowerCase(), port, origin: `${scheme}://${m[2].toLowerCase()}:${port}` };
}

export function checkOrigin(url, baseUrl, blockedPorts) {
  const u = parseOrigin(url);
  const b = parseOrigin(baseUrl);
  if (!u || !b) return 'unparseable URL';
  if ((blockedPorts || []).includes(u.port)) return `blocked port ${u.port} (direct backend access forbidden)`;
  if (u.origin !== b.origin) return `origin ${u.origin} is not the frontend ${b.origin}`;
  return null;
}

export function assertVuTotal(slots, runType, expected) {
  const n = (slots || []).length;
  if (String(runType).toUpperCase() === 'BENCHMARK' && n !== expected) {
    throw new Error(`G1 violation: ${n} VUs configured; BENCHMARK requires exactly ${expected} (browser VUs included)`);
  }
  if (n < 1) throw new Error('no VUs configured');
  return n;
}

export function isEc21(host, resolvedIps, denylist) {
  const deny = new Set((denylist || []).map((d) => String(d).trim().toLowerCase()).filter(Boolean));
  const cands = [String(host || '').toLowerCase(), ...(resolvedIps || []).map((x) => String(x).toLowerCase())];
  return cands.find((c) => deny.has(c)) || null;
}
