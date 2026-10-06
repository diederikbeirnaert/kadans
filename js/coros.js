// Koppeling met COROS MCP, volledig vanuit de browser.
// OAuth 2.0 met PKCE als publieke client (geen geheim), daarna JSON-RPC naar het MCP-endpoint.

const MCP_URL = 'https://mcp.coros.com/mcp';
const SCOPE = 'openid mcp.tools offline_access';
const KEY = 'kadans.coros';
const PENDING = 'kadans.coros.pending';
const PROTOCOL = '2025-06-18';

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = (s) => localStorage.setItem(KEY, JSON.stringify(s));
// Altijd de map van de app, zodat elke pagina dezelfde registratie en tokens deelt.
const redirectUri = () => new URL('./', location.origin + location.pathname).href;

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function json(res) {
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = null; }
  if (!res.ok) throw new Error(body?.error_description || body?.error || `${res.status} ${text.slice(0, 200)}`);
  return body;
}

// De regio (EU/US/CN) volgt uit de metadata; die bewaren we samen met de client-registratie.
async function setup() {
  const s = load();
  if (s.meta && s.clientId && s.redirectUri === redirectUri()) return s;
  const resource = await json(await fetch(new URL('/.well-known/oauth-protected-resource/mcp', MCP_URL)));
  const issuer = resource.authorization_servers[0];
  const meta = await json(await fetch(issuer + '/.well-known/oauth-authorization-server'));
  const reg = await json(await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Kadans',
      redirect_uris: [redirectUri()],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: SCOPE,
    }),
  }));
  const next = { meta, resource: resource.resource, clientId: reg.client_id, redirectUri: redirectUri() };
  save(next);
  return next;
}

export const isConnected = () => !!load().tokens?.access_token;

export async function connect() {
  const s = await setup();
  const verifier = random(48);
  const state = random(16);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  sessionStorage.setItem(PENDING, JSON.stringify({ verifier, state }));
  const url = new URL(s.meta.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code', client_id: s.clientId, redirect_uri: s.redirectUri, scope: SCOPE,
    state, code_challenge: challenge, code_challenge_method: 'S256', resource: s.resource,
  });
  location.assign(url);
}

// Roep dit aan bij het laden: verwerkt de terugkeer van COROS. Geeft true als er net gekoppeld is.
export async function handleRedirect() {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') && !params.has('error')) return false;
  const pending = JSON.parse(sessionStorage.getItem(PENDING) || 'null');
  sessionStorage.removeItem(PENDING);
  history.replaceState(null, '', location.pathname);
  if (params.has('error')) throw new Error(params.get('error_description') || params.get('error'));
  if (!pending || pending.state !== params.get('state')) throw new Error('De koppeling is onderbroken. Probeer opnieuw.');
  const s = load();
  await token(s, {
    grant_type: 'authorization_code', code: params.get('code'), redirect_uri: s.redirectUri,
    client_id: s.clientId, code_verifier: pending.verifier, resource: s.resource,
  });
  return true;
}

async function token(s, form) {
  const t = await json(await fetch(s.meta.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  }));
  s.tokens = {
    access_token: t.access_token,
    refresh_token: t.refresh_token || s.tokens?.refresh_token,
    expires_at: Date.now() + (t.expires_in || 3600) * 1000,
  };
  save(s);
  return s.tokens;
}

let refreshing = null;
async function accessToken(force = false) {
  const s = load();
  if (!s.tokens) throw new Error('Niet gekoppeld met COROS.');
  if (!force && s.tokens.expires_at - Date.now() > 60_000) return s.tokens.access_token;
  if (!s.tokens.refresh_token) { disconnect(); throw new Error('De koppeling is verlopen. Koppel opnieuw.'); }
  refreshing ||= token(s, { grant_type: 'refresh_token', refresh_token: s.tokens.refresh_token, client_id: s.clientId })
    .catch((e) => { disconnect(); throw new Error('De koppeling is verlopen. Koppel opnieuw. (' + e.message + ')'); })
    .finally(() => { refreshing = null; });
  return (await refreshing).access_token;
}

export function disconnect() {
  const s = load();
  delete s.tokens;
  save(s);
}

// --- MCP (streamable HTTP, stateless) ---

let rpcId = 0;
let initialized = null;
let sessionId = null;

async function post(message, retry = true) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: 'Bearer ' + await accessToken(),
    'MCP-Protocol-Version': PROTOCOL,
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const res = await fetch(load().resource || MCP_URL, { method: 'POST', headers, body: JSON.stringify(message) });
  if (res.status === 401 && retry) { await accessToken(true); return post(message, false); }
  sessionId = res.headers.get('mcp-session-id') || sessionId;
  if (message.id === undefined) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`COROS gaf ${res.status}: ${text.slice(0, 300)}`);
  // Het antwoord komt als gewone JSON of als SSE-stroom; in het tweede geval zoeken we ons eigen id.
  let reply;
  if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
    reply = text.split(/\r?\n\r?\n/)
      .map((ev) => ev.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n'))
      .filter(Boolean).map((d) => { try { return JSON.parse(d); } catch { return null; } })
      .find((m) => m && m.id === message.id);
  } else reply = JSON.parse(text);
  if (!reply) throw new Error('Leeg antwoord van COROS.');
  if (reply.error) throw new Error(reply.error.message || JSON.stringify(reply.error));
  return reply.result;
}

const rpc = (method, params) => post({ jsonrpc: '2.0', id: ++rpcId, method, params });

async function init() {
  initialized ||= (async () => {
    const info = await rpc('initialize', {
      protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'Kadans', version: '0.1' },
    });
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return info;
  })().catch((e) => { initialized = null; throw e; });
  return initialized;
}

export async function listTools() {
  await init();
  const tools = [];
  let cursor;
  do {
    const page = await rpc('tools/list', cursor ? { cursor } : {});
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

// Geeft { data, raw }: data is de geparste JSON als COROS die teruggeeft, anders de tekst.
export async function callTool(name, args = {}) {
  await init();
  const raw = await rpc('tools/call', { name, arguments: args });
  const text = (raw.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (raw.isError) throw new Error(text || 'COROS meldde een fout.');
  let data = raw.structuredContent;
  if (data === undefined) { try { data = JSON.parse(text); } catch { data = text; } }
  return { data, raw };
}
