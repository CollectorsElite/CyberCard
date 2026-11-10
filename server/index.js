'use strict';
// Server HTTP + WebSocket di ESCALATION.
// Serve il client statico, gestisce le stanze e fa girare il motore di gioco in memoria.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game, GameError, DEFAULT_TIMEOUTS } = require('./game');
const { decide } = require('./bots');
const { buildDecks } = require('./cards');

const PORT = +process.env.PORT || 3000;
const BOT_DELAY = process.env.BOT_DELAY !== undefined ? +process.env.BOT_DELAY : 1600;
const GRACE = process.env.DISCONNECT_GRACE_MS !== undefined ? +process.env.DISCONNECT_GRACE_MS : 15000;
const TIMEOUT_SCALE = +process.env.TIMEOUT_SCALE || 1;
const TUT_HOLD_MS = 3 * 60 * 1000;
const MAX_ROOMS = +process.env.MAX_ROOMS || 200;
const ROOM_IDLE_MS = 30 * 60 * 1000;
const ROOM_MAX_MS = +process.env.ROOM_MAX_MS || 4 * 60 * 60 * 1000;
const MAX_CREATES_PER_SOCKET = +process.env.MAX_CREATES_PER_SOCKET || 5;
const MAX_CREATES_PER_IP = +process.env.MAX_CREATES_PER_IP || 20;
const MIN_PLAYERS = 3, MAX_PLAYERS = 6;
const BOT_NAMES = ['Kevin (helpdesk)', 'Dott.ssa Ferri (CISO)', 'Il Fornitore «certificato»', 'Sig.ra Bianchi (CED dal 1994)', 'Lo Stagista con admin', 'Il Consulente a giornata'];
const PROD = process.env.NODE_ENV === 'production';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

/* ---------------- file statici ---------------- */
const PUB = path.join(__dirname, '..', 'public');
const ART = path.join(__dirname, '..', 'art', 'cards');
const BOARD = path.join(__dirname, '..', 'art', 'board');
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/client.js': ['client.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/admin.html': ['admin.html', 'text/html; charset=utf-8'],
  '/admin.js': ['admin.js', 'text/javascript; charset=utf-8']
};
const CACHE = Object.fromEntries(Object.entries(FILES).map(([u, [f, type]]) => [u, { body: fs.readFileSync(path.join(PUB, f)), type }]));
// Wiki delle Regole: una voce per carta del mazzo, con il numero di copie.
const catalog = new Map();
for (const c of Object.values(buildDecks(() => 0, x => x)).flat()) {
  const k = c.type + '|' + c.name;
  if (catalog.has(k)) catalog.get(k).n++; else catalog.set(k, { ...c, uid: undefined, n: 1 });
}
CACHE['/catalog.json'] = { body: Buffer.from(JSON.stringify([...catalog.values()])), type: 'application/json; charset=utf-8' };

function securityHeaders() {
  return {
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY'
  };
}

function adminAuthed(req) {
  if (!ADMIN_TOKEN) return false;
  const u = new URL(req.url || '/', 'http://local');
  const tok = String(u.searchParams.get('token') || req.headers['x-admin-token'] || '');
  const a = Buffer.from(tok), b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...securityHeaders() });
  res.end(JSON.stringify(obj));
}

function forceCloseRoom(code) {
  const room = rooms.get(code);
  if (!room) return false;
  clearTimeout(room.timer);
  for (const m of room.members) {
    if (m.ws) {
      send(m.ws, { t: 'expired' });
      m.ws.ctx.member = null; m.ws.ctx.room = null;
      try { m.ws.close(4002, 'admin'); } catch (e) { /* ignore */ }
    }
  }
  rooms.delete(code);
  return true;
}

function handleAdmin(req, res) {
  const pathOnly = (req.url || '/').split('?')[0];
  if (!ADMIN_TOKEN) return json(res, 404, { error: 'Admin disabilitato (imposta ADMIN_TOKEN).' });
  if (!adminAuthed(req)) return json(res, 401, { error: 'Non autorizzato.' });
  const q = new URL(req.url || '/', 'http://local').searchParams;
  if (pathOnly === '/admin/api/rooms') {
    return json(res, 200, {
      rooms: [...rooms.values()].map(r => ({
        code: r.code, host: r.host, started: !!r.game, over: !!(r.game && r.game.over),
        members: r.members.length, humans: r.members.filter(m => !m.isBot && !m.left).length,
        bots: r.members.filter(m => m.isBot).length,
        createdAt: r.createdAt, lastActive: r.lastActive
      })),
      config: {
        maxRooms: MAX_ROOMS, minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS,
        botDelay: BOT_DELAY, timeoutScale: TIMEOUT_SCALE, graceMs: GRACE, roomMaxMs: ROOM_MAX_MS,
        handLayoutDefault: 'row' // impostazione grafica: fan arriva dopo
      }
    });
  }
  if (pathOnly === '/admin/api/close') {
    const code = String(q.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (!code) return json(res, 400, { error: 'Codice mancante.' });
    if (!forceCloseRoom(code)) return json(res, 404, { error: 'Stanza non trovata.' });
    return json(res, 200, { ok: true, code });
  }
  return json(res, 404, { error: 'Endpoint admin sconosciuto.' });
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  if (url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (url.startsWith('/admin/api/')) return handleAdmin(req, res);
  const art = url.match(/^\/cards\/([a-z0-9-]{1,80})\.jpg$/);
  if (art) {
    const fp = path.join(ART, art[1] + '.jpg');
    if (!fp.startsWith(ART)) { res.writeHead(404); return res.end(); }
    fs.readFile(fp, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Non trovato'); }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400', ...securityHeaders() });
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
    return;
  }
  const board = url.match(/^\/board\/(felt|back-ticket|back-asset|logo|tut-1|tut-2|tut-3|desk|room)\.jpg$/);
  if (board) {
    const fp = path.join(BOARD, board[1] + '.jpg');
    if (!fp.startsWith(BOARD)) { res.writeHead(404); return res.end(); }
    fs.readFile(fp, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Non trovato'); }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400', ...securityHeaders() });
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
    return;
  }
  const f = CACHE[url];
  if (!f) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Non trovato'); }
  res.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': 'no-cache', ...securityHeaders() });
  res.end(req.method === 'HEAD' ? undefined : f.body);
});

/* ---------------- stanze ---------------- */
const rooms = new Map();
const ipCreates = new Map(); // ip -> { n, resetAt }
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => { let c; do { c = Array.from({ length: 5 }, () => ALPHA[crypto.randomInt(ALPHA.length)]).join(''); } while (rooms.has(c)); return c; };
const newId = () => crypto.randomBytes(6).toString('hex');
const newToken = () => crypto.randomBytes(18).toString('base64url');
const cleanName = n => String(n || '').replace(/[\u0000-\u001f\u007f<>"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);

function uniqueName(room, name) {
  let n = name, i = 2;
  while (room.members.some(m => m.name.toLowerCase() === n.toLowerCase())) n = `${name} ${i++}`;
  return n;
}
function suggestBotName(room) {
  const free = BOT_NAMES.filter(n => !room.members.some(m => m.name === n));
  return free[0] || uniqueName(room, 'Bot');
}
// Nome assente: suggerimento intero. Altrimenti la stessa cleanName dei giocatori (max 20).
function botName(room, raw) {
  const suggestion = suggestBotName(room);
  if (raw == null) return suggestion;
  if (String(raw).replace(/\s+/g, ' ').trim() === suggestion) return suggestion;
  return cleanName(raw);
}
function roomView(room, me) {
  return {
    code: room.code, host: room.host, you: me ? me.id : null, started: !!room.game, over: !!(room.game && room.game.over),
    min: MIN_PLAYERS, max: MAX_PLAYERS, nextBot: room.game ? null : suggestBotName(room),
    members: room.members.map(m => ({ id: m.id, name: m.name, isBot: m.isBot, connected: m.isBot || m.connected, left: !!m.left }))
  };
}
function tutInfo(room) {
  if (!room.tutHeld) return null;
  const humans = room.members.filter(m => !m.isBot && !m.left);
  return { ready: humans.filter(m => room.tutReady.has(m.id)).length, total: humans.length };
}
function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(room) {
  const tut = tutInfo(room);
  for (const m of room.members) {
    if (m.isBot || !m.ws) continue;
    send(m.ws, { t: 'sync', room: roomView(room, m), view: room.game ? room.game.view(m.id) : null, tut });
  }
}
function liftTutIfReady(room) {
  if (!room.tutHeld || !room.game) return;
  const humans = room.members.filter(m => !m.isBot && !m.left);
  if (humans.length && !humans.every(m => room.tutReady.has(m.id))) return;
  room.tutHeld = false;
  const g = room.game;
  if (!g.over && g.turn === 1 && g.phase === 'open' && !g.combat) g.setDeadline(g.to.turn);
}
function afterChange(room) { liftTutIfReady(room); room.lastActive = Date.now(); broadcast(room); pump(room); }

function allowCreate(ws) {
  if (++ws.ctx.createTries > MAX_CREATES_PER_SOCKET) return false;
  const ip = ws.ctx.ip || '';
  const now = Date.now();
  let e = ipCreates.get(ip);
  if (!e || now > e.resetAt) e = { n: 0, resetAt: now + 3600000 };
  e.n++;
  ipCreates.set(ip, e);
  return e.n <= MAX_CREATES_PER_IP;
}

function humansLeft(room) {
  return room.members.filter(x => !x.isBot && !x.left);
}

function transferHost(room, exceptId) {
  const cands = humansLeft(room).filter(x => x.id !== exceptId);
  if (!cands.length) return;
  room.host = (cands.find(x => x.connected) || cands[0]).id;
}

// Fa agire bot e assenti, e programma il prossimo risveglio per i timeout.
function pump(room) {
  clearTimeout(room.timer); room.timer = null;
  const g = room.game; if (!g || g.over) return;
  if (room.tutHeld) {
    room.timer = setTimeout(() => {
      room.timer = null;
      if (room.game !== g || g.over || !room.tutHeld) return;
      for (const m of room.members) if (!m.isBot && !m.left) room.tutReady.add(m.id);
      afterChange(room);
    }, Math.max(50, g.deadline - Date.now()));
    return;
  }
  const now = Date.now();
  const actorFor = id => {
    const m = room.members.find(x => x.id === id);
    if (!m) return null;
    if (m.isBot) return decide(g, id);
    if (!m.connected && (m.left || now - m.discAt >= GRACE)) return g.passiveAction(id);
    return null;
  };
  const schedule = (id, delay, requireNeed) => {
    room.timer = setTimeout(() => {
      room.timer = null;
      if (room.game !== g || g.over) return;
      if (requireNeed && !g.needs().includes(id)) { afterChange(room); return; }
      const m = room.members.find(x => x.id === id);
      const fresh = m && m.isBot ? decide(g, id) : actorFor(id);
      if (fresh) { try { g.handle(id, fresh); } catch (e) { if (!(e instanceof GameError)) console.error(e); } }
      afterChange(room);
    }, delay);
  };

  for (const id of g.needs()) {
    const a = actorFor(id);
    if (!a) continue;
    const m = room.members.find(x => x.id === id);
    const delay = !m.isBot ? 300 : a.type === 'pass' ? BOT_DELAY * 0.4 : BOT_DELAY * (0.7 + Math.random() * 0.6);
    schedule(id, delay, true);
    return;
  }
  // Bot fuori turno: equip/sell/curse come gli umani.
  for (const m of room.members) {
    if (!m.isBot || m.left) continue;
    const a = decide(g, m.id);
    if (!a) continue;
    schedule(m.id, BOT_DELAY * (0.7 + Math.random() * 0.6), false);
    return;
  }
  let wake = g.nextDeadline();
  const waiting = g.needs();
  for (const m of room.members) {
    if (!m.isBot && !m.connected && !m.left && waiting.includes(m.id) && m.discAt + GRACE > now) wake = Math.min(wake, m.discAt + GRACE);
  }
  room.timer = setTimeout(() => {
    room.timer = null;
    if (room.game !== g || g.over) return;
    try {
      let did = false;
      const t = Date.now();
      for (const id of g.needs()) {
        const m = room.members.find(x => x.id === id);
        if (!m || m.isBot || m.connected || !(m.left || t - m.discAt >= GRACE)) continue;
        const a = g.passiveAction(id);
        if (a) { g.handle(id, a); did = true; break; }
      }
      if (!did) g.timeout();
    } catch (e) { console.error(e); }
    afterChange(room);
  }, Math.max(50, wake - now));
}

function startGame(room) {
  const players = room.members.filter(m => !m.left);
  room.game = new Game(players.map(m => ({ id: m.id, name: m.name, isBot: m.isBot })), {
    timeouts: Object.fromEntries(Object.entries(DEFAULT_TIMEOUTS).map(([k, v]) => [k, Math.round(v * TIMEOUT_SCALE)]))
  });
  room.members = players;
  room.tutReady = new Set();
  room.tutHeld = players.some(m => !m.isBot);
  if (room.tutHeld) room.game.setDeadline(Math.round(TUT_HOLD_MS * TIMEOUT_SCALE));
  afterChange(room);
}

/* ---------------- messaggi ---------------- */
function handleMessage(ws, msg) {
  const ctx = ws.ctx;
  if (!msg || typeof msg.t !== 'string') return send(ws, { t: 'error', msg: 'Messaggio non valido.' });

  if (msg.t === 'create' || msg.t === 'join' || msg.t === 'resume') {
    // Cambio stanza = leave esplicito (niente ghost in lobby).
    if (ctx.member) detach(ws, true);

    if (msg.t === 'create') {
      const name = cleanName(msg.name); if (!name) return send(ws, { t: 'error', msg: 'Scrivi un nome.' });
      if (!allowCreate(ws)) return send(ws, { t: 'error', msg: 'Troppe stanze create. Riprova più tardi.' });
      if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'error', msg: 'Server pieno, riprova più tardi.' });
      const now = Date.now();
      const room = { code: newCode(), host: null, members: [], game: null, timer: null, lastActive: now, createdAt: now };
      const m = { id: newId(), token: newToken(), name, isBot: false, ws, connected: true, discAt: 0 };
      room.host = m.id; room.members.push(m); rooms.set(room.code, room);
      return attach(ws, room, m);
    }
    const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    const room = rooms.get(code);
    if (msg.t === 'join') {
      if (++ctx.joinTries > 20) return ws.close(1008, 'Troppi tentativi');
      if (!room) return send(ws, { t: 'error', msg: 'Stanza non trovata.' });
      if (room.game) return send(ws, { t: 'error', msg: 'La partita è già iniziata.' });
      if (room.members.length >= MAX_PLAYERS) return send(ws, { t: 'error', msg: 'Stanza piena.' });
      const name = cleanName(msg.name); if (!name) return send(ws, { t: 'error', msg: 'Scrivi un nome.' });
      const m = { id: newId(), token: newToken(), name: uniqueName(room, name), isBot: false, ws, connected: true, discAt: 0 };
      room.members.push(m);
      return attach(ws, room, m);
    }
    // resume
    const tok = Buffer.from(String(msg.token || ''));
    const m = room && room.members.find(x => !x.isBot && x.token.length === tok.length && crypto.timingSafeEqual(Buffer.from(x.token), tok));
    if (!m || m.left) return send(ws, { t: 'expired' });
    if (m.ws && m.ws !== ws) { send(m.ws, { t: 'error', msg: 'Sessione aperta su un altro dispositivo.' }); m.ws.ctx.member = null; m.ws.close(4000, 'sostituita'); }
    m.token = newToken();
    m.ws = ws; m.connected = true;
    return attach(ws, room, m);
  }

  const { room, member: me } = ctx;
  if (!room || !me) return send(ws, { t: 'error', msg: 'Non sei in una stanza.' });
  const isHost = room.host === me.id;

  switch (msg.t) {
    case 'addBot': {
      if (!isHost || room.game) return send(ws, { t: 'error', msg: 'Solo l\'host, prima dell\'inizio.' });
      if (room.members.length >= MAX_PLAYERS) return send(ws, { t: 'error', msg: 'Stanza piena.' });
      const name = botName(room, 'name' in msg ? msg.name : null);
      if (!name) return send(ws, { t: 'error', msg: 'Scrivi un nome.' });
      if (room.members.some(m => m.name.toLowerCase() === name.toLowerCase())) return send(ws, { t: 'error', msg: 'Nome già in uso.' });
      room.members.push({ id: newId(), token: '', name, isBot: true, connected: true });
      return afterChange(room);
    }
    case 'renameBot': {
      if (!isHost || room.game) return send(ws, { t: 'error', msg: 'Solo l\'host, prima dell\'inizio.' });
      const m = room.members.find(x => x.id === msg.id && x.isBot);
      if (!m) return send(ws, { t: 'error', msg: 'Bot non trovato.' });
      const trimmed = String(msg.name == null ? '' : msg.name).replace(/\s+/g, ' ').trim();
      if (trimmed.toLowerCase() === m.name.toLowerCase()) return afterChange(room);
      const name = cleanName(msg.name);
      if (!name) return send(ws, { t: 'error', msg: 'Scrivi un nome.' });
      if (room.members.some(x => x !== m && x.name.toLowerCase() === name.toLowerCase())) return send(ws, { t: 'error', msg: 'Nome già in uso.' });
      m.name = name;
      return afterChange(room);
    }
    case 'tutDone': {
      if (!room.game || !room.tutHeld) return;
      room.tutReady.add(me.id);
      return afterChange(room);
    }
    case 'removeMember': {
      if (!isHost || room.game) return send(ws, { t: 'error', msg: 'Solo l\'host, prima dell\'inizio.' });
      const m = room.members.find(x => x.id === msg.id);
      if (!m || m.id === me.id) return;
      room.members = room.members.filter(x => x !== m);
      if (m.ws) {
        send(m.ws, { t: 'kicked' });
        m.ws.ctx.member = null; m.ws.ctx.room = null;
        m.ws.close(4001, 'kicked');
      }
      return afterChange(room);
    }
    case 'start':
      if (!isHost || room.game) return send(ws, { t: 'error', msg: 'Solo l\'host può avviare la partita.' });
      if (room.members.length < MIN_PLAYERS) return send(ws, { t: 'error', msg: `Servono almeno ${MIN_PLAYERS} giocatori (aggiungi dei bot).` });
      return startGame(room);
    case 'rematch':
      if (!isHost || !room.game || !room.game.over) return send(ws, { t: 'error', msg: 'Solo l\'host, a partita finita.' });
      if (room.members.filter(m => !m.left).length < MIN_PLAYERS) return send(ws, { t: 'error', msg: 'Non ci sono abbastanza giocatori.' });
      return startGame(room);
    case 'act': {
      if (!room.game) return send(ws, { t: 'error', msg: 'La partita non è iniziata.' });
      if (room.tutHeld) return send(ws, { t: 'error', msg: 'In attesa che tutti chiudano le istruzioni.' });
      if (!msg.a || typeof msg.a !== 'object') return send(ws, { t: 'error', msg: 'Azione non valida.' });
      try { room.game.handle(me.id, msg.a); }
      catch (e) {
        if (e instanceof GameError) return send(ws, { t: 'error', msg: e.message });
        console.error(e); return send(ws, { t: 'error', msg: 'Errore interno.' });
      }
      return afterChange(room);
    }
    case 'leave': return detach(ws, true);
    default: return send(ws, { t: 'error', msg: 'Comando sconosciuto.' });
  }
}

function attach(ws, room, m) {
  ws.ctx.room = room; ws.ctx.member = m;
  send(ws, { t: 'session', code: room.code, token: m.token, you: m.id });
  afterChange(room);
}
function detach(ws, leaving) {
  const { room, member: m } = ws.ctx;
  ws.ctx.room = null; ws.ctx.member = null;
  if (!room || !m) return;
  if (m.ws === ws) { m.ws = null; m.connected = false; m.discAt = Date.now(); }

  if (leaving) {
    if (!room.game) room.members = room.members.filter(x => x !== m);
    else m.left = true;
    send(ws, { t: 'left' });
  }

  if (!humansLeft(room).length) {
    clearTimeout(room.timer); rooms.delete(room.code); return;
  }
  // Host failover anche su disconnect (lobby e partita).
  if (room.host === m.id) transferHost(room, m.id);
  afterChange(room);
}

/* ---------------- WebSocket ---------------- */
const wss = new WebSocketServer({
  server, path: '/ws', maxPayload: 4096,
  verifyClient: ({ origin, req }) => {
    if (!origin) return !PROD; // in produzione solo browser con Origin
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  }
});
wss.on('connection', (ws, req) => {
  ws.ctx = {
    room: null, member: null, tokens: 20, last: Date.now(), dropped: 0, joinTries: 0, createTries: 0,
    // ponytail: x-forwarded-for solo dietro proxy che lo sanitizza; altrimenti spoofabile
    ip: String((req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '')
  };
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (data, isBinary) => {
    const c = ws.ctx, now = Date.now();
    c.tokens = Math.min(20, c.tokens + (now - c.last) / 100); c.last = now; // 10 messaggi al secondo
    if (c.tokens < 1) { if (++c.dropped > 100) ws.close(1008, 'Troppi messaggi'); return; }
    c.tokens--;
    if (isBinary) return;
    let msg; try { msg = JSON.parse(data.toString('utf8')); } catch { return send(ws, { t: 'error', msg: 'JSON non valido.' }); }
    try { handleMessage(ws, msg); } catch (e) { console.error(e); send(ws, { t: 'error', msg: 'Errore interno.' }); }
  });
  ws.on('close', () => detach(ws, false));
});
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
}, 25000);
const janitor = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    // Lobby: via i posti disconnect oltre GRACE (ghost).
    if (!room.game) {
      const n0 = room.members.length;
      room.members = room.members.filter(m => m.isBot || m.connected || now - m.discAt < GRACE);
      if (room.members.length !== n0) {
        if (!humansLeft(room).length) { clearTimeout(room.timer); rooms.delete(code); continue; }
        if (!room.members.some(m => m.id === room.host)) transferHost(room, null);
        afterChange(room);
      }
    }
    const online = room.members.some(m => !m.isBot && m.connected);
    const stale = now - room.createdAt > ROOM_MAX_MS;
    const idle = !online && now - room.lastActive > ROOM_IDLE_MS;
    if (stale || idle) { clearTimeout(room.timer); rooms.delete(code); }
  }
}, 60000);

function shutdown() {
  for (const ws of wss.clients) send(ws, { t: 'error', msg: 'Il server si sta riavviando: le partite in corso andranno perse.' });
  clearInterval(heartbeat); clearInterval(janitor);
  for (const room of rooms.values()) clearTimeout(room.timer);
  wss.close(); server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => console.log(`ESCALATION in ascolto sulla porta ${PORT}`));
module.exports = { server, rooms };
