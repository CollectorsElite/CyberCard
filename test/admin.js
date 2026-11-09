'use strict';
// Admin API: disabilitato senza token, 401 se sbagliato, lista/chiudi stanze se ok.
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 7000 + Math.floor(Math.random() * 500);
const TOKEN = 'test-admin-token-32chars-xxxxxx';
const env = { ...process.env, PORT: String(PORT), ADMIN_TOKEN: TOKEN, BOT_DELAY: '0', NODE_ENV: 'development' };
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
const wait = ms => new Promise(r => setTimeout(r, ms));
const base = `http://127.0.0.1:${PORT}`;

(async () => {
  try {
    await wait(400);
    assert.strictEqual((await fetch(`${base}/admin/api/rooms`)).status, 401);
    assert.strictEqual((await fetch(`${base}/admin/api/rooms?token=wrong`)).status, 401);
    const ok = await fetch(`${base}/admin/api/rooms?token=${encodeURIComponent(TOKEN)}`);
    assert.strictEqual(ok.status, 200);
    const body = await ok.json();
    assert(Array.isArray(body.rooms));
    assert.strictEqual(body.config.maxRooms, 200);

    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
    let session = null;
    ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'session') session = m; });
    ws.send(JSON.stringify({ t: 'create', name: 'AdminTest' }));
    const t0 = Date.now();
    while (!session && Date.now() - t0 < 3000) await wait(20);
    assert(session, 'create fallito');

    const listed = await (await fetch(`${base}/admin/api/rooms?token=${encodeURIComponent(TOKEN)}`)).json();
    assert(listed.rooms.some(r => r.code === session.code), 'stanza assente in admin');

    const closed = await fetch(`${base}/admin/api/close?token=${encodeURIComponent(TOKEN)}&code=${session.code}`);
    assert.strictEqual(closed.status, 200);
    const after = await (await fetch(`${base}/admin/api/rooms?token=${encodeURIComponent(TOKEN)}`)).json();
    assert(!after.rooms.some(r => r.code === session.code), 'stanza non chiusa');

    assert.strictEqual((await fetch(`${base}/admin.html`)).status, 200);
    assert.strictEqual((await fetch(`${base}/admin.js`)).status, 200);
    // Wiki carte: il catalogo copre tutto il mazzo, una voce per carta.
    const cat = await (await fetch(`${base}/catalog.json`)).json();
    const { T, A } = require('../server/cards').buildDecks(() => 0, x => x);
    assert.strictEqual(cat.reduce((s, c) => s + c.n, 0), T.length + A.length);
    assert.strictEqual(new Set(cat.map(c => c.type + c.name)).size, cat.length);

    console.log('OK admin');
    srv.kill(); process.exit(0);
  } catch (e) {
    console.error('FALLITO:', e.message);
    srv.kill(); process.exit(1);
  }
})();
