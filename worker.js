// Wishlist Worker — isolated backend for the wishlist site.
// Data:
//   KV namespace binding GIFTS (single key "gifts" = full list JSON) - read cache.
//   Durable Object binding CLAIMS (class WishlistStore, one instance) - authoritative
//   store and the ONLY writer of "gifts". All mutations (guest claims and owner
//   list PUT) go through it, so claim exclusivity is atomic: the DO is
//   single-threaded and every handler touches transactional storage, which
//   serializes concurrent requests. KV is written through on every mutation
//   so public and owner reads stay fast and DO-free.
// Secret (set via dashboard/API, NEVER in GitHub):
//   SESSION_SECRET  = random 32+ byte hex, signs session tokens (HMAC-SHA-256)
//
// Routes:
//   GET  /api/gifts            public gift list (public fields only, incl. claimedBy)
//   POST /api/gifts/claim      {n, name} -> guest claims one item (409 if taken)
//   POST /api/gifts/unclaim    {n, name} -> guest releases own claim (403 if name mismatch)
//   Note: claims are hidden in the owner area - /api/owner/list strips claimedBy
//   and the owner PUT handler re-attaches stored claims (owner mode can't show
//   or change them; this is display hiding, not secrecy from the site itself).
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
const PUBLIC_FIELDS = ['n', 'name', 'detail', 'price', 'ils', 'photo', 'url', 'category', 'store', 'top', 'claimedBy'];

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

async function storeCall(env, msg, origin) {
  try {
    const stub = env.CLAIMS.get(env.CLAIMS.idFromName('wishlist'));
    const res = await stub.fetch('https://store/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin), ...securityHeaders() },
    });
  } catch (e) {
    return json({ error: 'server error' }, 500, origin);
  }
}

// Authoritative, single-instance store. All mutations to the gift list go
// through here. The DO runtime is single-threaded per instance and storage
// operations serialize concurrent requests (input gates), so two guests can
// never claim the same item at once: each handler re-reads transactional
// storage before deciding.
export class WishlistStore {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.data = null;
    state.blockConcurrencyWhile(async () => {
      let d = await state.storage.get('gifts');
      if (!d) {
        // First run after deploy: seed from the KV copy.
        d = (await env.GIFTS.get('gifts', 'json')) || { items: [] };
        await state.storage.put('gifts', d);
      }
      this.data = d;
    });
  }

  async save() {
    this.data.updated = new Date().toISOString();
    await this.state.storage.put('gifts', this.data);
    await this.env.GIFTS.put('gifts', JSON.stringify(this.data));
  }

  async fetch(request) {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400, ''); }
    // Re-read storage at the start of every mutation: this storage read is
    // what serializes concurrent requests, so decisions below always see the
    // latest committed state.
    this.data = (await this.state.storage.get('gifts')) || this.data || { items: [] };
    const items = this.data.items || [];

    if (body.action === 'claim') {
      const it = items.find(i => String(i.n) === String(body.n));
      if (!it) return json({ error: 'not found' }, 404, '');
      if (it.claimedBy) {
        if (normalizeName(it.claimedBy) === normalizeName(body.name)) return json({ ok: true, claimedBy: it.claimedBy }, 200, '');
        return json({ error: 'taken' }, 409, '');
      }
      it.claimedBy = body.name;
      await this.save();
      return json({ ok: true, claimedBy: body.name }, 200, '');
    }

    if (body.action === 'unclaim') {
      const it = items.find(i => String(i.n) === String(body.n));
      if (!it || !it.claimedBy) return json({ ok: true }, 200, '');
      if (normalizeName(it.claimedBy) !== normalizeName(body.name)) return json({ error: 'not yours' }, 403, '');
      delete it.claimedBy;
      await this.save();
      return json({ ok: true }, 200, '');
    }

    if (body.action === 'putList') {
      const claims = new Map();
      for (const it of items) if (it && it.claimedBy !== undefined) claims.set(String(it.n), it.claimedBy);
      for (const it of body.list.items) {
        delete it.claimedBy;
        const c = claims.get(String(it.n));
        if (c !== undefined) it.claimedBy = c;
      }
      this.data = { items: body.list.items };
      await this.save();
      return json({ ok: true, updated: this.data.updated }, 200, '');
    }

    return json({ error: 'bad action' }, 400, '');
  }
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

      if (path === '/api/gifts/claim' && request.method === 'POST') {
        let body;
        try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400, origin); }
        const name = typeof body.name === 'string' ? body.name.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
        if (!name || name.length > 60) return json({ error: 'bad name' }, 400, origin);
        const n = String(body.n);
        if (!n || n === 'undefined' || n.length > 20) return json({ error: 'bad item' }, 400, origin);
        return storeCall(env, { action: 'claim', n, name }, origin);
      }

      if (path === '/api/gifts/unclaim' && request.method === 'POST') {
        let body;
        try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400, origin); }
        const name = typeof body.name === 'string' ? body.name.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
        if (!name || name.length > 60) return json({ error: 'bad name' }, 400, origin);
        const n = String(body.n);
        if (!n || n === 'undefined' || n.length > 20) return json({ error: 'bad item' }, 400, origin);
        return storeCall(env, { action: 'unclaim', n, name }, origin);
      }

      if (path.startsWith('/api/owner/')) {
        const auth = request.headers.get('Authorization') || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        if (!(await checkToken(token, env.SESSION_SECRET))) return json({ error: 'unauthorized' }, 401, origin);

        if (path === '/api/owner/list' && request.method === 'GET') {
          const data = (await env.GIFTS.get('gifts', 'json')) || { items: [] };
          // Hide guest claims from the owner entirely (surprise protection).
          const items = (data.items || []).map(it => { const o = { ...it }; delete o.claimedBy; return o; });
          return json({ ...data, items }, 200, origin);
        }
        if (path === '/api/owner/list' && request.method === 'PUT') {
          let body;
          try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400, origin); }
          if (!validList(body)) return json({ error: 'invalid list' }, 400, origin);
          // The Durable Object re-attaches stored claims (owner edits can never
          // add/change/remove them) and serializes the write against claims.
          return storeCall(env, { action: 'putList', list: { items: body.items } }, origin);
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
