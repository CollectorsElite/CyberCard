'use strict';
// Lifecycle: host failover, ghost lobby, create cap, token rotate, kick close.
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 5000 + Math.floor(Math.random() * 1000);
const env = {
  ...process.env, PORT: String(PORT), BOT_DELAY: '0', TIMEOUT_SCALE: '0.02',
  DISCONNECT_GRACE_MS: '200', MAX_CREATES_PER_SOCKET: '3', MAX_CREATES_PER_IP: '50',
  NODE_ENV: 'development'
};
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
const wait = ms => new Promise(r => setTimeout(r, ms));
const URL = `ws://127.0.0.1:${PORT}/ws`;

function client() {
  const ws = new WebSocket(URL);
  const c = { ws, msgs: [], last: null, session: null, errors: [], closed: null };
  ws.on('message', d => {
    const m = JSON.parse(d.toString());
    c.msgs.push(m);
    if (m.t === 'sync') c.last = m;
    if (m.t === 'session') c.session = m;
    if (m.t === 'error') c.errors.push(m.msg);
    if (m.t === 'left' || m.t === 'kicked' || m.t === 'expired') c.ctrl = m.t;
  });
  ws.on('close', (code) => { c.closed = code; });
  c.send = m => ws.send(JSON.stringify(m));
  c.open = new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  return c;
}
async function until(fn, ms = 5000, what = 'condizione') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return; await wait(20); }
  throw new Error('Timeout: ' + what);
}

(async () => {
  try {
    await wait(400);

    // --- host disconnect in lobby → host passa al survivor ---
    const h = client(), g = client();
    await Promise.all([h.open, g.open]);
    h.send({ t: 'create', name: 'Host' });
    await until(() => h.session, 3000, 'host session');
    const code1 = h.session.code;
    g.send({ t: 'join', code: code1, name: 'Guest' });
    await until(() => g.session && h.last && h.last.room.members.length === 2, 3000, '2 in lobby');
    h.ws.close();
    await until(() => g.last && g.last.room.host === g.session.you, 3000, 'host failover');
    g.send({ t: 'addBot' });
    await until(() => g.last && g.last.room.members.some(m => m.isBot), 3000, 'guest addBot as host');
    assert(!g.errors.some(e => e.includes('host')), 'addBot rifiutato dopo failover: ' + g.errors.join('; '));

    // --- create switch: no ghost in old lobby ---
    const a = client(), b = client();
    await Promise.all([a.open, b.open]);
    a.send({ t: 'create', name: 'A1' });
    await until(() => a.session, 3000, 'A1');
    const codeA = a.session.code;
    b.send({ t: 'join', code: codeA, name: 'B1' });
    await until(() => b.session && a.last.room.members.length === 2, 3000, 'A+B lobby');
    a.send({ t: 'create', name: 'A2' });
    await until(() => a.session && a.session.code !== codeA, 3000, 'A new room');
    await until(() => b.last.room.members.length === 1 && b.last.room.members[0].id === b.session.you, 3000, 'no ghost in old lobby');
    assert.strictEqual(b.last.room.host, b.session.you, 'B becomes host of orphan lobby');

    // --- create cap per socket ---
    const spam = client();
    await spam.open;
    for (let i = 0; i < 5; i++) {
      spam.send({ t: 'create', name: 'Spam' + i });
      await wait(50);
    }
    await until(() => spam.errors.some(e => e.includes('Troppe stanze')), 3000, 'create cap');

    // --- token rotate on resume ---
    const r1 = client(), r2 = client();
    await Promise.all([r1.open, r2.open]);
    r1.send({ t: 'create', name: 'R' });
    await until(() => r1.session, 3000, 'R session');
    const tok = r1.session.token, codeR = r1.session.code;
    r2.send({ t: 'join', code: codeR, name: 'R2' });
    await until(() => r2.session, 3000, 'R2 join');
    r1.ws.close(); await wait(100);
    const r1b = client(); await r1b.open;
    r1b.send({ t: 'resume', code: codeR, token: tok });
    await until(() => r1b.session, 3000, 'resume');
    assert.notStrictEqual(r1b.session.token, tok, 'new token');
    const stale = client(); await stale.open;
    stale.send({ t: 'resume', code: codeR, token: tok });
    await until(() => stale.ctrl === 'expired', 3000, 'old token expired');

    // --- kick closes socket ---
    const kH = client(), kV = client();
    await Promise.all([kH.open, kV.open]);
    kH.send({ t: 'create', name: 'KH' });
    await until(() => kH.session, 3000, 'KH');
    kV.send({ t: 'join', code: kH.session.code, name: 'KV' });
    await until(() => kV.session && kH.last.room.members.length === 2, 3000, 'KV in');
    const victimId = kV.session.you;
    kH.send({ t: 'removeMember', id: victimId });
    await until(() => kV.ctrl === 'kicked' && kV.closed === 4001, 3000, 'kicked+close');

    // CSP connect-src 'self'
    const res = await fetch(`http://127.0.0.1:${PORT}/`);
    assert(res.headers.get('content-security-policy').includes("connect-src 'self'"), 'csp');

    console.log('OK lifecycle');
    srv.kill();

    // production: Origin obbligatorio
    const PORT2 = PORT + 1;
    const srv2 = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
      env: { ...env, PORT: String(PORT2), NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'inherit']
    });
    await wait(400);
    const url2 = `ws://127.0.0.1:${PORT2}/ws`;
    const refused = await new Promise(r => {
      const w = new WebSocket(url2);
      w.on('error', () => r(true));
      w.on('open', () => { w.close(); r(false); });
    });
    assert(refused, 'production senza Origin accettata');
    const allowed = await new Promise(r => {
      const w = new WebSocket(url2, { origin: `http://127.0.0.1:${PORT2}` });
      w.on('open', () => { w.close(); r(true); });
      w.on('error', () => r(false));
    });
    assert(allowed, 'production con Origin rifiutata');
    srv2.kill();
    console.log('OK production origin');
    process.exit(0);
  } catch (e) {
    console.error('FALLITO:', e.message);
    srv.kill(); process.exit(1);
  }
})();
