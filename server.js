'use strict';
/**
 * ATM device-code POC server (zero runtime dependencies, Node 18+).
 *
 *  - Serves ./public
 *  - Proxies the OAuth 2.0 Device Authorization Grant (RFC 8628) calls to the
 *    PingOne Advanced Identity Cloud tenant, because the browser cannot call the
 *    tenant's OAuth2 endpoints directly unless CORS is configured on the tenant.
 *    Same pattern as the Smart TV demo: /api/device-flow/{start,poll,user-info}.
 *  - Tenant/realm/client are supplied per request by the front end (persisted in
 *    the browser), so changing them never requires a server restart.
 *
 * Env:
 *   PORT             default 8080
 *   ALLOWED_HOSTS    optional comma-separated hostnames the proxy may call
 *                    (e.g. "openam-example.forgeblocks.com"). Empty = any https host.
 *   CONFIG_FILE      optional path to a JSON file with default settings (config.default.json)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8081);
const PUBLIC_DIR = path.join(__dirname, 'public');
const CONFIG_FILE = process.env.CONFIG_FILE || path.join(__dirname, 'config.default.json');
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const UPSTREAM_TIMEOUT_MS = 15000;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Build the AM OAuth2 base URL, e.g. https://tenant/am/oauth2/realms/root/realms/alpha */
function oauthBase(cfg) {
  if (!cfg || typeof cfg.tenantUrl !== 'string' || !cfg.tenantUrl.trim()) {
    throw new HttpError(400, 'tenantUrl is required');
  }
  let u;
  try { u = new URL(cfg.tenantUrl.trim()); } catch { throw new HttpError(400, 'tenantUrl is not a valid URL'); }
  if (u.protocol !== 'https:') throw new HttpError(400, 'tenantUrl must be https');
  if (ALLOWED_HOSTS.length && !ALLOWED_HOSTS.includes(u.hostname.toLowerCase())) {
    throw new HttpError(403, `Host ${u.hostname} is not in ALLOWED_HOSTS`);
  }
  const realm = String(cfg.realm || 'alpha').trim().replace(/^\/+|\/+$/g, '');
  if (!/^[A-Za-z0-9_\-./]+$/.test(realm)) throw new HttpError(400, 'invalid realm');
  const realmPath = realm === 'root' ? 'realms/root'
    : 'realms/root/' + realm.split('/').map(r => `realms/${r}`).join('/');
  return `${u.origin}/am/oauth2/${realmPath}`;
}

async function upstream(url, { method = 'POST', form, bearer } = {}) {
  const headers = { Accept: 'application/json' };
  let body;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(Object.entries(form).filter(([, v]) => v !== undefined && v !== '')).toString();
  }
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  try {
    const r = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { error: 'upstream_non_json', error_description: text.slice(0, 300) }; }
    return { status: r.status, json };
  } catch (e) {
    return { status: 502, json: { error: 'upstream_unreachable', error_description: String(e.message || e) } };
  }
}

const routes = {
  // RFC 8628 §3.1 Device Authorization Request
  'POST /api/device-flow/start': async ({ config }) => {
    const base = oauthBase(config);
    if (!config.clientId) throw new HttpError(400, 'clientId is required');
    return upstream(`${base}/device/code`, {
      form: { client_id: config.clientId, scope: config.scopes, acr_values: config.acrValues, ui_locales: config.uiLocales },
    });
  },
  // RFC 8628 §3.4 Device Access Token Request (single poll)
  'POST /api/device-flow/poll': async ({ config, code }) => {
    const base = oauthBase(config);
    if (!code) throw new HttpError(400, 'code is required');
    return upstream(`${base}/access_token`, {
      form: {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: code,
        client_id: config.clientId,
      },
    });
  },
  'POST /api/device-flow/user-info': async ({ config, access_token }) => {
    const base = oauthBase(config);
    if (!access_token) throw new HttpError(400, 'access_token is required');
    return upstream(`${base}/userinfo`, { method: 'GET', bearer: access_token });
  },
  // RFC 7009 token revocation (ATM "end session")
  'POST /api/device-flow/logout': async ({ config, access_token }) => {
    const base = oauthBase(config);
    if (!access_token) throw new HttpError(400, 'access_token is required');
    const r = await upstream(`${base}/token/revoke`, { form: { token: access_token, client_id: config.clientId } });
    // AM returns 200 with an empty body on success, which upstream() reports as non-JSON.
    if (r.status === 200) return { status: 200, json: { revoked: true } };
    return r;
  },
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 64 * 1024) { reject(new HttpError(413, 'body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function loadDefaults() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  try {
    if (req.method === 'GET' && pathname === '/api/config') return send(res, 200, loadDefaults());
    if (req.method === 'GET' && pathname === '/healthz') return send(res, 200, { ok: true });
    const handler = routes[`${req.method} ${pathname}`];
    if (handler) {
      const payload = await readJson(req);
      const { status, json } = await handler(payload);
      return send(res, status, json);
    }
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
    send(res, 405, { error: 'method_not_allowed' });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    send(res, status, { error: 'proxy_error', error_description: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`ATM device-flow POC listening on http://localhost:${PORT}`);
  if (ALLOWED_HOSTS.length) console.log(`Proxy restricted to: ${ALLOWED_HOSTS.join(', ')}`);
});

module.exports = { oauthBase }; // exported for tests
