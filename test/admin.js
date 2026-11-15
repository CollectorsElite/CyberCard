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
    const H = { headers: { 'X-Admin-Token': TOKEN } };
    assert.strictEqual((await fetch(`${base}/admin/api/rooms`, { headers: { 'X-Admin-Token': 'wrong' } })).status, 401);
    assert.strictEqual((await fetch(`${base}/admin/api/rooms?token=${encodeURIComponent(TOKEN)}`)).status, 401, 'token nell\'indirizzo non più accettato');
    const ok = await fetch(`${base}/admin/api/rooms`, H);
    assert.strictEqual(ok.status, 200);
    const body = await ok.json();
    assert(Array.isArray(body.rooms));
    assert.strictEqual(body.config.maxRooms, 200);

    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
    let session = null, expired = null, synced = 0;
    ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'session') session = m; if (m.t === 'expired') expired = m; if (m.t === 'sync' && m.view) synced++; });
    ws.send(JSON.stringify({ t: 'create', name: 'AdminTest' }));
    const until = async (fn, what) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < 3000) await wait(20); assert(fn(), what); };
    await until(() => session, 'create fallito');
    ws.send(JSON.stringify({ t: 'addBot' })); ws.send(JSON.stringify({ t: 'addBot' }));
    await wait(200);
    ws.send(JSON.stringify({ t: 'start' }));
    await until(() => synced > 0, 'partita non avviata');

    const listed = await (await fetch(`${base}/admin/api/rooms`, H)).json();
    const room = listed.rooms.find(r => r.code === session.code);
    assert(room && room.state === 'in corso' && room.game, 'partita assente in admin');
    assert.strictEqual(room.game.players.length, 3);
    assert(room.game.players.every(p => typeof p.level === 'number' && typeof p.esp === 'number' && p.status), 'stato giocatori');
    assert(room.game.players.some(p => p.name === 'AdminTest' && p.status === 'connesso'));
    assert(!JSON.stringify(room).includes('"hand"'), 'le carte in mano non escono dal server');
    assert(room.closesAt > Date.now() && room.startedAt <= Date.now());

    assert.strictEqual((await fetch(`${base}/admin/api/close?code=${session.code}`, H)).status, 405, 'chiusura via GET');
    const closed = await fetch(`${base}/admin/api/close?code=${session.code}`, { method: 'POST', ...H });
    assert.strictEqual(closed.status, 200);
    await until(() => expired, 'il giocatore non è stato avvisato');
    assert(/amministratore/.test(expired.msg));
    const after = await (await fetch(`${base}/admin/api/rooms`, H)).json();
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
