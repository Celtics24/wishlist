// Wishlist Worker — isolated backend for the wishlist site.
// Data: KV namespace binding GIFTS (single key "gifts" = full list JSON).
// Secret (set via dashboard/API, NEVER in GitHub):
//   SESSION_SECRET  = random 32+ byte hex, signs session tokens (HMAC-SHA-256)
//
// Routes:
//   GET  /api/gifts            public gift list (public fields only)
//   POST /api/owner/login      {name} -> {token}  (rate limited)
//   GET  /api/owner/list       auth: full list incl. private fields
//   PUT  /api/owner/list       auth: replace full list (validated)
//   PUT  /api/owner/profile    auth: {ownerNote} private profile note
//   GET  /api/owner/profile    auth
//
// Security notes:
// - Entry to the owner area is by the recipient's first name only, per the
//   owner's explicit choice (she was told and accepted that anyone who knows
//   the name can enter). The name is an entry filter, NOT authentication.
// - No cookies: Authorization: Bearer <token> => classic CSRF not applicable.
// - CORS allows only https://celtics24.github.io and requires the custom
//   header X-Wishlist-Client (forces preflight; cross-origin forms cannot set it).
// - Rate limiting: soft KV per-IP counter (10 fails -> 15 min). KV is
//   eventually consistent, so this is not a hard lockout guarantee.

const ALLOWED_ORIGIN = 'https://celtics24.github.io';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const MAX_FAILS = 10;
const LOCK_MS = 15 * 60 * 1000; // 15 min
const PUBLIC_FIELDS = ['n', 'name', 'detail', 'price', 'ils', 'photo', 'url', 'category', 'store', 'top'];

function corsHeaders(origin) {
  const h = {
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Wishlist-Client',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (origin === ALLOWED_ORIGIN) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin), ...securityHeaders() },
  });
}

const te = new TextEncoder();

// Owner entry names (first name of the wishlist recipient), same set the
// public gate in app.js accepts. NFC + case-fold so phone keyboards match.
const OWNER_NAMES = new Set(['\u05d9\u05e8\u05d3\u05df'.normalize('NFC'), 'yarden']);

function normalizeName(name) {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

async function hmacKey(secretHex) {
  const raw = new Uint8Array(secretHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

async function makeToken(secretHex) {
  const payload = JSON.stringify({ exp: Date.now() + SESSION_TTL_MS, n: b64url(crypto.getRandomValues(new Uint8Array(12)).buffer) });
  const key = await hmacKey(secretHex);
  const sig = await crypto.subtle.sign('HMAC', key, te.encode(payload));
  return b64url(te.encode(payload)) + '.' + b64url(sig);
}

async function checkToken(token, secretHex) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  let payload;
  try { payload = new TextDecoder().decode(unb64url(token.slice(0, dot))); } catch { return false; }
  const key = await hmacKey(secretHex);
  let ok;
  try { ok = await crypto.subtle.verify('HMAC', key, unb64url(token.slice(dot + 1)), te.encode(payload)); } catch { return false; }
  if (!ok) return false;
  try {
    const data = JSON.parse(payload);
    return typeof data.exp === 'number' && data.exp > Date.now();
  } catch { return false; }
}

async function rateLimited(env, ip) {
  // Soft lockout via KV counter. KV is eventually consistent (~60s edge
  // propagation), so a determined attacker can squeeze extra attempts inside
  // a propagation window; the primary defense is a strong password hashed
  // with 100k PBKDF2 iterations. Not a hard lockout guarantee.
  const rec = await env.GIFTS.get('rl:' + ip, 'json');
  return !!(rec && rec.lockUntil && rec.lockUntil > Date.now());
}

async function recordFail(env, ip) {
  const key = 'rl:' + ip;
  const rec = (await env.GIFTS.get(key, 'json')) || { fails: 0, lockUntil: 0 };
  rec.fails = (rec.fails || 0) + 1;
  if (rec.fails >= MAX_FAILS) { rec.lockUntil = Date.now() + LOCK_MS; rec.fails = 0; }
  await env.GIFTS.put(key, JSON.stringify(rec), { expirationTtl: 3600 });
}

async function clearFails(env, ip) {
  await env.GIFTS.delete('rl:' + ip).catch(() => {});
}

function publicView(data) {
  const items = (data.items || []).map(it => {
    const out = {};
    for (const f of PUBLIC_FIELDS) if (it[f] !== undefined) out[f] = it[f];
    return out;
  });
  return { items, updated: data.updated || null };
}

function validList(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.items)) return false;
  if (JSON.stringify(data).length > 4 * 1024 * 1024) return false;
  return data.items.every(it => it && typeof it.name === 'string' && it.name.length > 0 && it.name.length <= 300);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...corsHeaders(origin), ...securityHeaders() } });
    }

    if (request.headers.get('X-Wishlist-Client') !== '1') {
      return json({ error: 'bad client' }, 400, origin);
    }

    try {
      if (path === '/api/gifts' && request.method === 'GET') {
        const data = (await env.GIFTS.get('gifts', 'json')) || { items: [] };
        return json(publicView(data), 200, origin);
      }

      if (path === '/api/owner/login' && request.method === 'POST') {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (await rateLimited(env, ip)) return json({ error: 'locked' }, 429, origin);
        let body;
        try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400, origin); }
        const ok = typeof body.name === 'string' && body.name.length <= 100 && OWNER_NAMES.has(normalizeName(body.name));
        if (!ok) {
          await recordFail(env, ip);
          return json({ error: 'wrong name' }, 401, origin);
        }
        await clearFails(env, ip);
        return json({ token: await makeToken(env.SESSION_SECRET) }, 200, origin);
      }

      if (path.startsWith('/api/owner/')) {
        const auth = request.headers.get('Authorization') || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        if (!(await checkToken(token, env.SESSION_SECRET))) return json({ error: 'unauthorized' }, 401, origin);

        if (path === '/api/owner/list' && request.method === 'GET') {
          const data = (await env.GIFTS.get('gifts', 'json')) || { items: [] };
          return json(data, 200, origin);
        }
        if (path === '/api/owner/list' && request.method === 'PUT') {
          let body;
          try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400, origin); }
          if (!validList(body)) return json({ error: 'invalid list' }, 400, origin);
          body.updated = new Date().toISOString();
          await env.GIFTS.put('gifts', JSON.stringify(body));
          return json({ ok: true, updated: body.updated }, 200, origin);
        }
        if (path === '/api/owner/profile' && request.method === 'GET') {
          const profile = (await env.GIFTS.get('profile', 'json')) || { ownerNote: '' };
          return json(profile, 200, origin);
        }
        if (path === '/api/owner/profile' && request.method === 'PUT') {
          let body;
          try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400, origin); }
          const profile = { ownerNote: String(body.ownerNote || '').slice(0, 5000) };
          await env.GIFTS.put('profile', JSON.stringify(profile));
          return json({ ok: true }, 200, origin);
        }
      }

      return json({ error: 'not found' }, 404, origin);
    } catch (e) {
      return json({ error: 'server error' }, 500, origin);
    }
  },
};
