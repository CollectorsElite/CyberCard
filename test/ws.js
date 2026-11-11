'use strict';
// Test di integrazione: server vero, 3 client WebSocket umani + 2 bot, partita fino alla fine.
// Verifica isolamento delle mani, rifiuto di azioni fuori turno, riconnessione e resistenza a input ostili.
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 4000 + Math.floor(Math.random() * 1000);
const env = { ...process.env, PORT: String(PORT), BOT_DELAY: '0', TIMEOUT_SCALE: '0.02', DISCONNECT_GRACE_MS: '300' };
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
const wait = ms => new Promise(r => setTimeout(r, ms));
const URL = `ws://127.0.0.1:${PORT}/ws`;

function client(label) {
  const ws = new WebSocket(URL);
  const c = { ws, label, msgs: [], last: null, session: null, errors: [] };
  ws.on('message', d => {
    const m = JSON.parse(d.toString());
    c.msgs.push(m);
    if (m.t === 'sync') c.last = m;
    if (m.t === 'session') c.session = m;
    if (m.t === 'error') c.errors.push(m.msg);
  });
  c.send = m => ws.send(JSON.stringify(m));
  c.open = new Promise(r => ws.on('open', r));
  return c;
}
async function until(fn, ms = 8000, what = 'condizione') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return; await wait(20); }
  throw new Error('Timeout in attesa di: ' + what);
}

(async () => {
  try {
    await wait(400);
    const a = client('A'), b = client('B'), c = client('C');
    await Promise.all([a.open, b.open, c.open]);

    a.send({ t: 'create', name: 'Alice <script>' });
    await until(() => a.session, 3000, 'sessione A');
    const code = a.session.code;
    assert.match(code, /^[A-Z0-9]{5}$/);
    assert(!a.last.room.members[0].name.includes('<'), 'nome non ripulito');

    b.send({ t: 'join', code, name: 'Bob' });
    c.send({ t: 'join', code: 'ZZZZZ', name: 'Carlo' });
    await until(() => c.errors.length, 3000, 'errore stanza inesistente');
    c.send({ t: 'join', code, name: 'Bob' });
    await until(() => c.session, 3000, 'sessione C');
    await until(() => a.last.room.members.length === 3, 3000, '3 membri');
    assert(a.last.room.members.some(m => m.name === 'Bob 2'), 'nomi duplicati non gestiti');

    b.send({ t: 'start' });
    await until(() => b.errors.some(e => e.includes('host')), 3000, 'start rifiutato a non host');
    a.send({ t: 'addBot', name: 'Nino' }); a.send({ t: 'addBot' });
    await until(() => a.last.room.members.length === 5 && a.last.room.members.some(m => m.name === 'Nino' && m.isBot), 3000, '5 membri');
    const nino = a.last.room.members.find(m => m.name === 'Nino');
    const errN = a.errors.length;
    a.send({ t: 'addBot', name: 'Nino' });
    a.send({ t: 'renameBot', id: nino.id, name: '   ' });
    a.send({ t: 'renameBot', id: nino.id, name: 'Bob' });
    await until(() => a.errors.length >= errN + 3, 3000, 'nomi bot rifiutati');
    assert(a.errors.slice(errN).some(e => e.includes('già')), 'duplicato bot accettato');
    assert(a.errors.slice(errN).some(e => e.includes('Scrivi')), 'nome bot vuoto accettato');
    assert.strictEqual(a.last.room.members.length, 5, 'bot duplicato aggiunto');
    a.send({ t: 'renameBot', id: nino.id, name: 'Nino2' });
    await until(() => a.last.room.members.some(m => m.id === nino.id && m.name === 'Nino2'), 3000, 'bot rinominato');
    const errB = b.errors.length;
    b.send({ t: 'renameBot', id: nino.id, name: 'Nope' });
    await until(() => b.errors.length > errB, 3000, 'rename non host');
    assert(b.errors.at(-1).includes('host'), 'rename bot consentito a non host');
    a.send({ t: 'start' });
    await until(() => a.last && a.last.view && b.last.view && c.last.view, 3000, 'partita avviata');
    assert.strictEqual(a.last.view.phase, 'open');
    assert.strictEqual(a.last.view.version, 0);
    assert(a.last.tut && a.last.tut.total === 3 && a.last.tut.ready === 0, 'gate tutorial assente');
    assert(a.last.view.deadlineIn > Math.round(90000 * 0.02), 'deadline del primo turno non è il gate: ' + a.last.view.deadlineIn);
    await wait(400);
    assert.strictEqual(a.last.view.version, 0, 'la partita avanza prima di tutDone');
    assert.strictEqual(a.last.view.phase, 'open');

    // isolamento: ognuno vede solo la propria mano, mai quella degli altri
    for (const x of [a, b, c]) {
      const v = x.last.view;
      assert.strictEqual(v.hand.length, v.cur === x.session.you ? 6 : 5, 'mano iniziale: 5 carte, più la dotazione per chi è di turno');
      assert.strictEqual(v.hand.filter(c => c.deck === 'A').length, v.cur === x.session.you ? 3 : 2);
      for (const p of v.players) assert(!('hand' in p), 'mano altrui nella vista');
    }
    const uidsA = new Set(a.last.view.hand.map(x => x.uid));
    assert(!b.last.view.hand.some(x => uidsA.has(x.uid)), 'mani sovrapposte');
    const raw = JSON.stringify(b.last);
    for (const card of a.last.view.hand) assert(!raw.includes(`"uid":${card.uid},`) || JSON.stringify(b.last.view.combat || '').includes(`"uid":${card.uid}`), 'carta di A visibile a B');

    // input ostili: azioni fuori turno, carte altrui, payload strani
    const notCur = [a, b, c].find(x => x.last.view.cur !== x.session.you);
    const errBefore = notCur.errors.length;
    notCur.send({ t: 'act', a: { type: 'openTicket' } });
    notCur.send({ t: 'act', a: { type: 'equip', card: a.last.view.hand[0].uid } });
    notCur.send({ t: 'act', a: { type: '__proto__' } });
    notCur.send({ t: 'act', a: null });
    notCur.ws.send('{non json');
    await until(() => notCur.errors.length >= errBefore + 5, 3000, 'rifiuto input ostili');
    a.send({ t: 'tutDone' });
    await until(() => a.last.tut && a.last.tut.ready === 1, 3000, 'un tutDone');
    for (const x of [b, c]) x.send({ t: 'tutDone' });
    await until(() => !a.last.tut && a.last.view.deadlineIn <= Math.round(90000 * 0.02) + 50, 3000, 'gate tutorial chiuso');

    // gli umani giocano in modo semplice: passano, aprono, chiudono turno
    const humans = [a, b, c];
    const decide = x => {
      const v = x.last && x.last.view; if (!v || v.over) return null;
      const me = x.session.you, cb = v.combat;
      if (!v.needs.includes(me)) return null;
      if (cb) {
        if (cb.offer && cb.offer.to === me) return { type: 'answerHelp', accept: Math.random() < 0.5 };
        if (cb.step === 'prep') return { type: 'fight' };
        if (cb.step === 'window') {
          const s = v.hand.find(k => k.type === 'boost' && k.amt > 0);
          if (cb.fighter !== me && cb.winning && s && Math.random() < 0.3) return { type: 'play', card: s.uid };
          return { type: 'pass' };
        }
        if (cb.step === 'flee') return { type: 'flee' };
        return null;
      }
      if (v.phase === 'open') return { type: 'openTicket' };
      if (v.phase === 'after') return { type: 'loot' };
      const ex = v.hand.length - v.handMax;
      return { type: 'endTurn', discard: ex > 0 ? v.hand.slice(0, ex).map(k => k.uid) : [] };
    };

    // a metà partita C si disconnette e poi riprende la sessione
    let reconnected = false;
    const t0 = Date.now();
    let lastVer = -1;
    while (Date.now() - t0 < 120000) {
      const v = a.last.view;
      if (v.over) break;
      if (!reconnected && v.turn >= 3 && c.ws.readyState === 1) {
        c.ws.close(); await wait(600);
        const c2 = client('C2'); await c2.open;
        const oldTok = c.session.token;
        c2.send({ t: 'resume', code, token: oldTok });
        await until(() => c2.session && c2.last && c2.last.view, 3000, 'ripresa sessione');
        assert.strictEqual(c2.session.you, c.session.you, 'identità cambiata alla ripresa');
        assert.notStrictEqual(c2.session.token, oldTok, 'token non ruotato al resume');
        humans[2] = c2; reconnected = true;
      }
      for (const x of humans) {
        if (x.ws.readyState !== 1) continue;
        if (x.last.view.version === lastVer && x.sent === x.last.view.version) continue;
        const act = decide(x);
        if (act && x.sent !== x.last.view.version) { x.sent = x.last.view.version; x.send({ t: 'act', a: act }); }
      }
      lastVer = a.last.view.version;
      await wait(15);
    }
    assert(a.last.view.over, 'partita non conclusa entro il tempo');
    assert(reconnected, 'riconnessione non testata');
    const w = a.last.view.players.find(p => p.id === a.last.view.winner);
    console.log(`partita completata: vince ${w.name} al giro ${a.last.view.turn}; errori ricevuti (attesi per input ostili) A=${a.errors.length} B=${b.errors.length}`);

    // rivincita
    a.send({ t: 'rematch' });
    await until(() => a.last.view && !a.last.view.over && a.last.view.turn === 1, 3000, 'rivincita');

    // file statici e header di sicurezza
    const res = await fetch(`http://127.0.0.1:${PORT}/`);
    assert.strictEqual(res.status, 200);
    assert(res.headers.get('content-security-policy').includes("script-src 'self'"));
    assert.strictEqual((await fetch(`http://127.0.0.1:${PORT}/../server/game.js`)).status, 404);
    assert.strictEqual((await fetch(`http://127.0.0.1:${PORT}/health`)).status, 200);

    // origine diversa rifiutata
    const evil = new WebSocket(URL, { origin: 'https://evil.example' });
    const refused = await new Promise(r => { evil.on('error', () => r(true)); evil.on('open', () => r(false)); });
    assert(refused, 'connessione cross-origin accettata');

    console.log('OK');
    srv.kill(); process.exit(0);
  } catch (e) {
    console.error('FALLITO:', e.message);
    srv.kill(); process.exit(1);
  }
})();
