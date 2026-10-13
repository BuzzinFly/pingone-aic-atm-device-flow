/* ATM device-code POC front end.
 * Flow: welcome → POST /api/device-flow/start → show QR (verification_uri_complete) + user code
 *       → poll /api/device-flow/poll until access_token → /user-info → ATM menu.
 * The phone completes login on the tenant's default hosted device page (/am/oauth2/.../device/user).
 */
(() => {
'use strict';

/* ------------------------------------------------------------------ config */
const LS_KEY = 'atm-poc-config-v1';
const HARD_DEFAULTS = {
  theme: 'bank', lang: 'es', brandName: '',
  tenantUrl: '', realm: 'alpha', clientId: 'atm-device', scopes: 'openid profile email',
  service: '', acrValues: '', qrTarget: 'complete', showManualCode: true,
  idleSeconds: 60, revokeOnLogout: true,
};
const THEME_BRANDS = { bank: 'MeridianBank', regional: 'Caja Vega Verde' };   // names shown on the landing pages
let cfg = { ...HARD_DEFAULTS };

const lsGet = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } };
const lsSet = (v) => { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); return true; } catch { return false; } };

async function loadConfig() {
  let server = {};
  try { const r = await fetch('api/config', { cache: 'no-store' }); if (r.ok) server = await r.json(); } catch { /* static hosting */ }
  cfg = { ...HARD_DEFAULTS, ...server, ...lsGet() };
  // Optional per-load overrides, e.g. ?theme=regional&lang=en (not persisted unless saved)
  const q = new URLSearchParams(location.search);
  for (const k of Object.keys(HARD_DEFAULTS)) if (q.has(k)) cfg[k] = q.get(k);
  if (q.has('tenant')) cfg.tenantUrl = q.get('tenant');
  if (q.has('client')) cfg.clientId = q.get('client');
  if (cfg.theme === 'generic') cfg.theme = 'bank';           // key used by earlier builds
  if (!['bank', 'regional'].includes(cfg.theme)) cfg.theme = 'bank';
  if (!['es', 'en'].includes(cfg.lang)) cfg.lang = 'es';
  cfg.idleSeconds = Math.max(0, Number(cfg.idleSeconds) || 0);
  cfg.showManualCode = cfg.showManualCode === true || cfg.showManualCode === 'true';
  cfg.revokeOnLogout = cfg.revokeOnLogout === true || cfg.revokeOnLogout === 'true';
}
const persist = () => lsSet(cfg);
const apiCfg = () => ({ tenantUrl: cfg.tenantUrl, realm: cfg.realm, clientId: cfg.clientId, scopes: cfg.scopes, acrValues: cfg.acrValues, uiLocales: cfg.lang });

/* -------------------------------------------------------------------- i18n */
const T = {
  es: {
    welcome: { bank: ['Tu banco, sin complicaciones.', 'Gestiona tus cuentas, tarjetas y ahorros de forma segura desde cualquier dispositivo.'], regional: ['Crecemos contigo, cerca de ti.', 'Una cooperativa de crédito comprometida con las personas, las empresas y el territorio.'] },
    start: 'Comenzar', help: '¿Necesita ayuda? Consulte con un asesor de la oficina.',
    pillSecure: 'Sin tarjeta · Sin PIN', pillPhone: 'Con su móvil',
    pairTitle: 'Inicie sesión con su móvil',
    s1: 'Escanee el código QR con la cámara de su teléfono.', s2: 'Confirme el código que aparece en su móvil.', s3: 'Inicie sesión de forma segura. El cajero continuará automáticamente.',
    or: 'o introduzca el código en su móvil', expiresIn: 'Caduca en', waiting: 'Esperando confirmación', cancel: 'Cancelar',
    starting: 'Preparando su sesión…', finishing: 'Accediendo a su cuenta…',
    hello: 'Hola', menuLead: '¿Qué desea hacer?',
    withdraw: 'Retirar efectivo', withdrawSub: 'Elija el importe', balance: 'Consultar saldo', balanceSub: 'Cuenta corriente',
    statement: 'Últimos movimientos', statementSub: 'Cuenta corriente', end: 'Finalizar sesión', endSub: 'Cerrar de forma segura',
    chooseAmount: 'Elija el importe a retirar', back: 'Volver', confirm: 'Confirmar',
    confirmTitle: 'Confirmar retirada', confirmText: 'Va a retirar', dispensing: 'Retire su efectivo', dispensingSub: 'Recoja los billetes de la bandeja.',
    insufficient: 'Saldo insuficiente', availBal: 'Saldo disponible', account: 'Cuenta corriente',
    goodbye: 'Sesión finalizada', goodbyeLead: 'Gracias por utilizar nuestro cajero.',
    idleTitle: '¿Sigue ahí?', idleLead: 'Por su seguridad, la sesión se cerrará en', idleKeep: 'Continuar sesión',
    expiredTitle: 'El código ha caducado', expiredLead: 'Por seguridad, el código solo es válido durante unos minutos.', retry: 'Generar nuevo código',
    deniedTitle: 'Acceso denegado', deniedLead: 'La solicitud fue rechazada desde el móvil.',
    errTitle: 'Servicio no disponible', errLead: 'No hemos podido completar la operación. Inténtelo de nuevo.',
    notConfigured: 'Configure la URL del tenant en los controles del POC (⚙ o Alt+Shift+C).',
    txn: { groceries: 'Supermercado', salary: 'Nómina', power: 'Recibo luz', transfer: 'Transferencia recibida', pharmacy: 'Farmacia', cash: 'Cajero · Efectivo' },
    lang: 'English', unit: '€',
  },
  en: {
    welcome: { bank: ['Your bank, without the hassle.', 'Manage your accounts, cards and savings securely from any device.'], regional: ['We grow with you, close to you.', 'A credit cooperative committed to people, businesses and the region.'] },
    start: 'Start', help: 'Need help? Please ask a branch advisor.',
    pillSecure: 'No card · No PIN', pillPhone: 'Use your phone',
    pairTitle: 'Sign in with your phone',
    s1: 'Scan the QR code with your phone camera.', s2: 'Confirm the code shown on your phone.', s3: 'Sign in securely. The ATM will continue automatically.',
    or: 'or enter the code on your phone', expiresIn: 'Expires in', waiting: 'Waiting for confirmation', cancel: 'Cancel',
    starting: 'Preparing your session…', finishing: 'Accessing your account…',
    hello: 'Hello', menuLead: 'What would you like to do?',
    withdraw: 'Withdraw cash', withdrawSub: 'Choose an amount', balance: 'Check balance', balanceSub: 'Current account',
    statement: 'Recent transactions', statementSub: 'Current account', end: 'End session', endSub: 'Sign out securely',
    chooseAmount: 'Choose the amount to withdraw', back: 'Back', confirm: 'Confirm',
    confirmTitle: 'Confirm withdrawal', confirmText: 'You are about to withdraw', dispensing: 'Please take your cash', dispensingSub: 'Collect the notes from the tray.',
    insufficient: 'Insufficient funds', availBal: 'Available balance', account: 'Current account',
    goodbye: 'Session ended', goodbyeLead: 'Thank you for using our ATM.',
    idleTitle: 'Are you still there?', idleLead: 'For your security, the session will end in', idleKeep: 'Continue session',
    expiredTitle: 'The code has expired', expiredLead: 'For security, the code is only valid for a few minutes.', retry: 'Generate a new code',
    deniedTitle: 'Access denied', deniedLead: 'The request was rejected on the phone.',
    errTitle: 'Service unavailable', errLead: 'We could not complete the operation. Please try again.',
    notConfigured: 'Set the tenant URL in the POC controls (⚙ or Alt+Shift+C).',
    txn: { groceries: 'Supermarket', salary: 'Salary', power: 'Electricity bill', transfer: 'Transfer received', pharmacy: 'Pharmacy', cash: 'ATM · Cash' },
    lang: 'Español', unit: '€',
  },
};
const t = (k) => T[cfg.lang][k];

/* ----------------------------------------------------------------- helpers */
const $ = (id) => document.getElementById(id);
const h = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => new Intl.NumberFormat(cfg.lang === 'es' ? 'es-ES' : 'en-GB', { style: 'currency', currency: 'EUR' }).format(n);
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, '0')}`;
const brandName = () => cfg.brandName.trim() || THEME_BRANDS[cfg.theme];
function decodeJwt(tok) {
  try {
    const p = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(atob(p).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')));
  } catch { return null; }
}

/* ------------------------------------------------------------------- logos */
function logo(theme, onDark) {
  if (theme === 'regional') {            // Caja Vega Verde: green disc with a leaf
    const bg = onDark ? '#fff' : '#40864e', fg = onDark ? '#40864e' : '#fff';
    return `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="24" fill="${bg}"/><path d="M14 33c0-11 7-18 21-18 0 13-6 20-16 20-2 0-3.500-.5-5-2z" fill="${fg}"/><path d="M13 36c5-8 10-12 17-16" stroke="${bg}" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`;
  }
  const bg = onDark ? '#fff' : '#1d4ed8', fg = onDark ? '#1d4ed8' : '#fff';   // MeridianBank: rounded square with an M
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="11" fill="${bg}"/><path d="M12 35V14l12 13 12-13v21" fill="none" stroke="${fg}" stroke-width="4.500" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function brandHtml() {
  const custom = cfg.brandName.trim();
  if (custom) return `<span class="n2">${h(custom)}</span>`;
  return cfg.theme === 'regional'
    ? `<span class="n1">Caja</span> <span class="n2">Vega Verde</span>`
    : `<span class="n1">Meridian</span><span class="n2">Bank</span>`;
}

/* -------------------------------------------------------------- inspector */
const log = [];
const maskLong = (v) => typeof v === 'string' && v.length > 70 ? v.slice(0, 34) + '…' + v.slice(-10) + ` (${v.length} chars)` : v;
const maskObj = (o) => (o && typeof o === 'object') ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, maskLong(v)])) : o;
function record(entry) { log.unshift({ ...entry, at: new Date() }); if (log.length > 60) log.pop(); renderInspector(); }
function renderInspector() {
  if ($('inspector').hidden) return;
  const claims = S.session ? decodeJwt(S.session.token) : null;
  const sessionBlock = S.session
    ? `<div class="insp-h">Current session</div>
       <details class="insp-item" open><summary><span class="tag">access_token claims</span></summary><pre>${h(JSON.stringify(claims, null, 2))}</pre></details>
       <details class="insp-item" open><summary><span class="tag">userinfo</span></summary><pre>${h(JSON.stringify(S.session.user, null, 2))}</pre></details>`
    : '';
  const fl = S.flow ? `<div class="insp-h">Active device flow</div>
     <details class="insp-item" open><summary><span class="tag">state</span></summary><pre>${h(JSON.stringify({
       user_code: S.flow.userCode, interval_s: S.flow.interval, verification_uri: S.flow.uri,
       verification_uri_complete: S.flow.uriComplete, qr_encodes: S.flow.qrUrl, polls: S.flow.polls }, null, 2))}</pre></details>` : '';
  $('inspBody').innerHTML = sessionBlock + fl + `<div class="insp-h">API calls (newest first)</div>` + (log.map(e => {
    const cls = e.status >= 500 ? 's5' : e.status >= 400 ? 's4' : 's2';
    const tag = e.body && e.body.error ? ` · ${e.body.error}` : '';
    return `<details class="insp-item"><summary><span class="tag ${cls}">${e.status}</span> ${h(e.path)}${h(tag)} <span style="margin-left:auto;opacity:.6">${e.at.toLocaleTimeString()}</span></summary>
      <pre>${h(JSON.stringify({ request: maskObj(e.req), response: maskObj(e.body) }, null, 2))}</pre></details>`;
  }).join('') || '<p style="opacity:.6">No calls yet.</p>');
}

/* --------------------------------------------------------------------- api */
async function api(path, payload) {
  let status = 0, body;
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    status = r.status; body = await r.json().catch(() => ({ error: 'bad_response' }));
  } catch (e) { body = { error: 'network_error', error_description: String(e.message || e) }; }
  const { config, ...reqRest } = payload;
  record({ path, status, req: reqRest, body });
  return { status, body };
}

/* ------------------------------------------------------------------- state */
const S = { screen: 'welcome', flow: null, session: null, idle: null, flowSeq: 0, timers: new Set() };
function later(fn, ms) { const id = setTimeout(() => { S.timers.delete(id); fn(); }, ms); S.timers.add(id); return id; }
function clearTimers() { S.timers.forEach(clearTimeout); S.timers.clear(); clearInterval(S.tick); S.tick = null; }

function setScreen(name, html, help, redraw) {
  S.screen = name; S.redraw = redraw || null;
  $('screen').innerHTML = html;
  $('footHelp').textContent = help ?? t('help');
}

/* ---------------------------------------------------------------- chrome */
function applyChrome() {
  document.body.dataset.theme = cfg.theme;
  document.documentElement.lang = cfg.lang;
  $('brand').innerHTML = `${logo(cfg.theme, false)}<span class="nm">${brandHtml()}</span>`;
  $('langBtn').textContent = t('lang');
  document.title = `${brandName()} · ATM`;
  document.querySelectorAll('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.themeVal === cfg.theme));
}
function tickClock() { $('clock').textContent = new Date().toLocaleTimeString(cfg.lang === 'es' ? 'es-ES' : 'en-GB', { hour: '2-digit', minute: '2-digit' }); }

/* --------------------------------------------------------------- screens */
function showWelcome() {
  resetSession(); clearTimers(); S.flow = null; S.flowSeq++;
  setScreen('welcome', `
    <div class="stack">
      <div class="welcome-mark">${logo(cfg.theme, true)}</div>
      <h1 class="big">${h(t('welcome')[cfg.theme][0])}</h1>
      <p class="lead">${h(t('welcome')[cfg.theme][1])}</p>
      <div class="hint-card"><span class="pill">📱 ${t('pillPhone')}</span><span class="pill">🔒 ${t('pillSecure')}</span></div>
      <button id="startBtn" class="btn-xl" type="button">${t('start')}</button>
    </div>`, undefined, showWelcome);
  $('startBtn').onclick = startFlow;
}

function showBusy(key) {
  setScreen('busy', `<div class="stack"><div class="spinner" role="status"></div><p class="lead">${h(t(key))}</p></div>`, '', () => showBusy(key));
}

function showMessage(kind, icon, build) {
  const { title, lead, btns } = build();
  setScreen(kind, `
    <div class="stack">
      <div class="status-ico ${kind === 'error' || kind === 'denied' ? 'err' : kind === 'expired' ? 'warn' : 'ok'}">${icon}</div>
      <h1 class="big">${h(title)}</h1>
      <p class="lead">${h(lead)}</p>
      <div class="row-btns">${btns.map((b, i) => `<button class="${b.primary ? 'btn-xl' : 'btn-outline'}" data-i="${i}" type="button">${h(b.label)}</button>`).join('')}</div>
    </div>`, undefined, () => showMessage(kind, icon, build));
  $('screen').querySelectorAll('button[data-i]').forEach(el => el.onclick = btns[el.dataset.i].on);
}
const retryCancel = () => [{ label: t('retry'), primary: true, on: startFlow }, { label: t('cancel'), on: showWelcome }];

const showError = (detail) => showMessage('error', '⚠', () => ({
  title: t('errTitle'), lead: detail ? `${t('errLead')} (${detail})` : t('errLead'), btns: retryCancel() }));

/* ---------------------------------------------------- device flow: start */
async function startFlow() {
  clearTimers(); resetSession();
  const seq = ++S.flowSeq;
  if (!cfg.tenantUrl.trim()) { showMessage('error', '⚙', () => ({ title: t('errTitle'), lead: t('notConfigured'), btns: [{ label: t('cancel'), on: showWelcome }] })); return; }
  showBusy('starting');
  const { status, body } = await api('api/device-flow/start', { config: apiCfg() });
  if (seq !== S.flowSeq) return;
  if (status !== 200 || !body.device_code) { showError(body.error_description || body.error || `HTTP ${status}`); return; }

  S.flow = {
    id: seq, deviceCode: body.device_code, userCode: body.user_code, uri: body.verification_uri, uriComplete: body.verification_uri_complete,
    interval: Math.max(1, Number(body.interval) || 5), expiresAt: Date.now() + (Number(body.expires_in) || 300) * 1000, polls: 0,
  };
  showPairing();
  later(pollLoop, S.flow.interval * 1000);
}

/* What the QR encodes. `locale`/`ui_locales` are hints so the tenant's hosted pages open in the ATM's language. */
function buildQrUrl(f) {
  const base = (cfg.qrTarget === 'plain' ? f.uri : f.uriComplete) || f.uriComplete || f.uri;
  const u = new URL(base);
  if (cfg.service.trim()) u.searchParams.set('service', cfg.service.trim());
  u.searchParams.set('locale', cfg.lang); u.searchParams.set('ui_locales', cfg.lang);
  return u.toString();
}

function showPairing() {
  const f = S.flow; clearInterval(S.tick);
  f.qrUrl = buildQrUrl(f);
  let qr = '';
  try { const q = qrcode(0, 'M'); q.addData(f.qrUrl); q.make(); qr = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); }
  catch (e) { qr = `<p class="muted">QR error: ${h(e.message)}</p>`; }
  setScreen('pairing', `
    <div class="pair">
      <div>
        <h1>${t('pairTitle')}</h1>
        <ol class="steps">
          <li><span class="n">1</span><span>${t('s1')}</span></li>
          <li><span class="n">2</span><span>${t('s2')}</span></li>
          <li><span class="n">3</span><span>${t('s3')}</span></li>
        </ol>
        <button id="cancelBtn" class="btn-outline" type="button">${t('cancel')}</button>
      </div>
      <div class="qr-card">
        <div class="qr-box" style="background:#fff;padding:6px;border-radius:10px">${qr}</div>
        ${cfg.showManualCode ? `<div class="or">${t('or')}</div><div class="code" id="userCode">${h(f.userCode)}</div>` : ''}
        <div class="timer"><span class="dots"><i></i><i></i><i></i></span> ${t('waiting')} · ${t('expiresIn')} <b id="remain"></b></div>
      </div>
    </div>`, '', showPairing);
  $('cancelBtn').onclick = showWelcome;
  const upd = () => {
    const left = Math.round((f.expiresAt - Date.now()) / 1000);
    const el = $('remain'); if (el) el.textContent = mmss(left);
    if (left <= 0 && f.id === S.flowSeq) showExpired();
  };
  upd(); S.tick = setInterval(upd, 1000);
}

/* ---------------------------------------------------- device flow: poll */
async function pollLoop() {
  const f = S.flow; if (!f || f.id !== S.flowSeq || S.screen !== 'pairing') return;
  f.polls++;
  const { status, body } = await api('api/device-flow/poll', { config: apiCfg(), code: f.deviceCode });
  if (f.id !== S.flowSeq) return;
  if (body.access_token) return onToken(body);
  switch (body.error) {
    case 'authorization_pending': break;
    case 'slow_down': f.interval += 5; break;                      // RFC 8628 §3.5
    case 'expired_token': return showExpired();
    case 'access_denied': return showMessage('denied', '✕', () => ({ title: t('deniedTitle'), lead: t('deniedLead'), btns: retryCancel() }));
    case 'network_error': case 'upstream_unreachable': f.netErrors = (f.netErrors || 0) + 1;
      if (f.netErrors > 5) return showError(body.error_description); break;
    default: if (status >= 400 && !body.error) break;
      return showError(body.error_description || body.error);
  }
  later(pollLoop, f.interval * 1000 + 250);
}

function showExpired() {
  clearTimers(); S.flowSeq++;
  showMessage('expired', '⏱', () => ({ title: t('expiredTitle'), lead: t('expiredLead'), btns: retryCancel() }));
}

async function onToken(tok) {
  clearTimers();
  const seq = S.flowSeq;
  showBusy('finishing');
  const { status, body } = await api('api/device-flow/user-info', { config: apiCfg(), access_token: tok.access_token });
  if (seq !== S.flowSeq) return;
  const user = status === 200 ? body : {};
  S.session = { token: tok.access_token, scope: tok.scope, user, balance: 3482.15, tx: [['groceries', -42.18], ['salary', 1850.00], ['power', -63.40], ['transfer', 120.00], ['pharmacy', -14.75]] };
  showMenu(); armIdle();
}

/* ------------------------------------------------------------ ATM screens */
const firstName = () => { const u = S.session.user; return u.given_name || (u.name || '').split(' ')[0] || u.preferred_username || ''; };

function showMenu() {
  const tiles = [
    ['withdraw', '💶', t('withdraw'), t('withdrawSub'), showWithdraw],
    ['balance', '🏦', t('balance'), t('balanceSub'), showBalance],
    ['statement', '🧾', t('statement'), t('statementSub'), showStatement],
    ['end', '⏻', t('end'), t('endSub'), endSession],
  ];
  setScreen('menu', `
    <div class="menu">
      <div class="menu-head"><h1>${t('hello')}${firstName() ? ', ' + h(firstName()) : ''}</h1><p>${t('menuLead')}</p></div>
      <div class="grid">${tiles.map((x, i) => `<button class="tile ${x[0] === 'end' ? 'end' : ''}" data-i="${i}" type="button"><span class="ico">${x[1]}</span><span>${x[2]}<small>${x[3]}</small></span></button>`).join('')}</div>
    </div>`, '', showMenu);
  $('screen').querySelectorAll('.tile').forEach(el => el.onclick = tiles[el.dataset.i][4]);
}

function backBtn() { const b = $('backBtn'); if (b) b.onclick = showMenu; }

function showWithdraw() {
  const amts = [20, 50, 100, 150, 200, 300];
  setScreen('withdraw', `
    <div class="stack"><h1 class="big">${t('chooseAmount')}</h1>
      <div class="amounts">${amts.map(a => `<button class="amt" data-a="${a}" type="button">${money(a).replace(/,00/, '').replace(/\.00/, '')}</button>`).join('')}</div>
      <button id="backBtn" class="btn-outline" type="button">${t('back')}</button></div>`, '', showWithdraw);
  backBtn();
  $('screen').querySelectorAll('.amt').forEach(el => el.onclick = () => confirmWithdraw(Number(el.dataset.a)));
}

function confirmWithdraw(a) {
  if (a > S.session.balance) {
    showMessage('error', '⚠', () => ({ title: t('insufficient'), lead: `${t('availBal')}: ${money(S.session.balance)}`, btns: [{ label: t('back'), primary: true, on: showWithdraw }] })); armIdle(); return;
  }
  setScreen('confirm', `
    <div class="stack"><h1 class="big">${t('confirmTitle')}</h1>
      <p class="lead">${t('confirmText')} <b>${money(a)}</b></p>
      <div class="row-btns"><button id="okBtn" class="btn-xl" type="button">${t('confirm')}</button><button id="backBtn" class="btn-outline" type="button">${t('back')}</button></div></div>`, '', () => confirmWithdraw(a));
  $('backBtn').onclick = showWithdraw;
  $('okBtn').onclick = () => {
    S.session.balance -= a; S.session.tx.unshift(['cash', -a]);
    const cash = () => setScreen('cash', `<div class="stack"><div class="status-ico ok">💶</div><h1 class="big">${t('dispensing')}</h1><p class="lead">${t('dispensingSub')}</p></div>`, '', cash);
    cash();
    later(showMenu, 3500);
  };
}

function showBalance() {
  setScreen('balance', `
    <div class="stack"><div class="panel-card"><h2>${t('account')}</h2><div class="muted">ES•• •••• •••• •• ••••••4821</div>
      <div class="muted" style="margin-top:14px">${t('availBal')}</div><div class="bal">${money(S.session.balance)}</div></div>
      <button id="backBtn" class="btn-outline" type="button">${t('back')}</button></div>`, '', showBalance);
  backBtn();
}

function showStatement() {
  setScreen('statement', `
    <div class="stack"><div class="panel-card"><h2>${t('statement')}</h2>
      <table class="tx">${S.session.tx.slice(0, 6).map(([d, a]) => `<tr><td>${h(t('txn')[d] || d)}</td><td class="${a < 0 ? 'neg' : 'pos'}">${money(a)}</td></tr>`).join('')}</table></div>
      <button id="backBtn" class="btn-outline" type="button">${t('back')}</button></div>`, '', showStatement);
  backBtn();
}

async function endSession() {
  const s = S.session;
  clearTimers(); S.flowSeq++;
  if (s && cfg.revokeOnLogout) await api('api/device-flow/logout', { config: apiCfg(), access_token: s.token });
  resetSession();
  const bye = () => setScreen('goodbye', `<div class="stack"><div class="status-ico ok">✓</div><h1 class="big">${t('goodbye')}</h1><p class="lead">${t('goodbyeLead')}</p></div>`, '', bye);
  bye();
  later(showWelcome, 4000);
}

/* ------------------------------------------------------------ idle guard */
const IDLE_WARN = 10;
function armIdle() {
  clearTimeout(S.idle); if (!S.session || !cfg.idleSeconds) return;
  S.idle = setTimeout(idleWarning, cfg.idleSeconds * 1000);
}
function idleWarning() {
  if (!S.session) return;
  const back = S.screen === 'cash' ? 'menu' : S.screen; let left = IDLE_WARN;
  setScreen('idle', `<div class="stack"><div class="status-ico warn">⏱</div><h1 class="big">${t('idleTitle')}</h1>
    <p class="lead">${t('idleLead')} <b id="idleLeft">${left}</b>s</p>
    <button id="keepBtn" class="btn-xl" type="button">${t('idleKeep')}</button></div>`, '');
  const iv = setInterval(() => { left--; const el = $('idleLeft'); if (el) el.textContent = left; if (left <= 0) { clearInterval(iv); endSession(); } }, 1000);
  $('keepBtn').onclick = () => { clearInterval(iv); showMenu(); armIdle(); };
}
function resetSession() { clearTimeout(S.idle); S.session = null; }
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { if (S.session && S.screen !== 'idle') armIdle(); }, true));

/* --------------------------------------------------------- POC controls */
const FIELDS = ['brandName', 'tenantUrl', 'realm', 'clientId', 'scopes', 'service', 'acrValues', 'qrTarget', 'idleSeconds', 'lang'];
const CHECKS = ['showManualCode', 'revokeOnLogout'];
function fillPanel() {
  FIELDS.forEach(k => { $('f_' + k).value = cfg[k]; });
  CHECKS.forEach(k => { $('f_' + k).checked = !!cfg[k]; });
}
function openPanel() { fillPanel(); $('panel').hidden = false; $('scrim').hidden = false; $('saveNote').textContent = ''; }
function closePanel() { $('panel').hidden = true; $('scrim').hidden = true; }
function readPanel() {
  FIELDS.forEach(k => { cfg[k] = $('f_' + k).value.trim(); });
  cfg.tenantUrl = cfg.tenantUrl.replace(/\/+$/, '').replace(/\/am(\/.*)?$/, '');
  cfg.idleSeconds = Math.max(0, Number(cfg.idleSeconds) || 0);
  CHECKS.forEach(k => { cfg[k] = $('f_' + k).checked; });
}
function setTheme(theme) { cfg.theme = theme; persist(); applyChrome(); if (S.screen === 'welcome') showWelcome(); }
function toggleInspector() { const el = $('inspector'); el.hidden = !el.hidden; renderInspector(); }

function wireUi() {
  $('gear').onclick = openPanel; $('panelClose').onclick = closePanel; $('scrim').onclick = closePanel;
  $('inspClose').onclick = toggleInspector; $('inspBtn').onclick = toggleInspector; $('inspClear').onclick = () => { log.length = 0; renderInspector(); };
  document.querySelectorAll('#themeSeg button').forEach(b => b.onclick = () => setTheme(b.dataset.themeVal));
  $('f_lang').onchange = () => setLang($('f_lang').value);
  $('langBtn').onclick = () => setLang(cfg.lang === 'es' ? 'en' : 'es');
  $('saveBtn').onclick = () => {
    readPanel(); const ok = persist(); applyChrome();
    $('saveNote').textContent = ok ? 'Saved in this browser. Restarting flow…' : 'Could not save (browser storage blocked) – applied for this session only.';
    closePanel(); showWelcome();
  };
  $('resetBtn').onclick = () => { try { localStorage.removeItem(LS_KEY); } catch { /* */ } location.replace(location.pathname); };
  $('exportBtn').onclick = () => {
    const a = document.createElement('a'); a.download = 'atm-poc-config.json';
    a.href = URL.createObjectURL(new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' })); a.click(); URL.revokeObjectURL(a.href);
  };
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const j = JSON.parse(await f.text()); cfg = { ...HARD_DEFAULTS, ...cfg, ...j }; persist(); applyChrome(); fillPanel(); $('saveNote').textContent = 'Imported and saved.'; }
    catch { $('saveNote').textContent = 'Invalid JSON file.'; }
    e.target.value = '';
  };
  document.addEventListener('keydown', (e) => {
    if (!(e.altKey && e.shiftKey)) return;
    if (e.code === 'KeyC') { e.preventDefault(); $('panel').hidden ? openPanel() : closePanel(); }
    else if (e.code === 'KeyT') { e.preventDefault(); setTheme(cfg.theme === 'bank' ? 'regional' : 'bank'); }
    else if (e.code === 'KeyI') { e.preventDefault(); toggleInspector(); }
  });
}
function setLang(lang) {
  cfg.lang = lang; persist(); applyChrome(); $('f_lang').value = lang;
  if (S.redraw) S.redraw();            // every screen registers how to redraw itself
  renderInspector();
}

/* ------------------------------------------------------------------- boot */
(async function boot() {
  await loadConfig();
  applyChrome(); wireUi(); tickClock(); setInterval(tickClock, 15000);
  showWelcome();
  if (new URLSearchParams(location.search).has('config') || !cfg.tenantUrl) openPanel();
})();
})();
