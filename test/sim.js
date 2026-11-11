'use strict';
// Simulazioni dirette del motore: partite tra bot, fuzzing di azioni ostili, invarianti.
const assert = require('assert');
const { Game, GameError } = require('../server/game');
const { decide } = require('../server/bots');

function allUids(g) {
  const ids = [];
  const push = c => c && ids.push(c.uid);
  g.decks.T.forEach(push); g.decks.A.forEach(push); g.disc.T.forEach(push); g.disc.A.forEach(push);
  for (const p of g.players) { p.hand.forEach(push); Object.values(p.gear).forEach(push); push(p.role); }
  if (g.combat) g.combat.threats.forEach(t => push(t.card));
  return ids;
}
function check(g, total) {
  const ids = allUids(g);
  assert.strictEqual(new Set(ids).size, ids.length, 'carta duplicata');
  assert.strictEqual(ids.length, total, `carte perse: ${ids.length}/${total}`);
  for (const p of g.players) {
    assert(p.level >= 1 && p.level <= 10, 'livello fuori range');
    assert(p.esp >= 0 && p.esp < 4, 'esposizione fuori range');
    for (const [s, gr] of Object.entries(p.gear)) if (gr) assert(gr.type === 'gear' && gr.slot === s, 'slot incoerente');
  }
}

const ACTS = ['openTicket', 'trouble', 'loot', 'endTurn', 'equip', 'unequip', 'takeRole', 'dropRole', 'levelUp', 'sell', 'discard', 'curse',
  'fight', 'play', 'pass', 'askHelp', 'cancelHelp', 'answerHelp', 'counterHelp', 'flee', 'rollback', '__proto__', 'constructor', 'hack'];
function randomAction(g, p) {
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const anyUid = () => (Math.random() < 0.8 && p.hand.length ? pick(p.hand).uid : pick([0, -1, 9999, 'x', null, 1.5]));
  return {
    type: pick(ACTS), card: anyUid(), threat: anyUid(), side: pick(['f', 'm', 'x']), slot: pick(['hw', 'sw', 'cr', 'gd', '__proto__']),
    target: pick([...g.players.map(x => x.id), 'nessuno']), to: pick([...g.players.map(x => x.id), 'nessuno']),
    share: pick([0, 1, 2, -1, 99, 'a']), accept: Math.random() < 0.5, discard: Math.random() < 0.5 ? g.autoDiscard(p) : [anyUid()]
  };
}

function play(nPlayers, fuzz) {
  let now = 0;
  const g = new Game(Array.from({ length: nPlayers }, (_, i) => ({ id: 'p' + i, name: 'P' + i, isBot: true })), { now: () => now });
  const total = allUids(g).length;
  let steps = 0, rejected = 0;
  while (!g.over && steps++ < 30000) {
    if (fuzz && Math.random() < 0.3) {
      const p = g.players[Math.floor(Math.random() * g.players.length)];
      try { g.handle(p.id, randomAction(g, p)); } catch (e) { if (!(e instanceof GameError)) throw e; rejected++; }
      check(g, total);
      continue;
    }
    let acted = false;
    for (const id of g.needs()) {
      const a = decide(g, id);
      if (a) { g.handle(id, a); acted = true; break; }
    }
    if (!acted) {
      for (const p of g.players) {
        const a = decide(g, p.id);
        if (a) { g.handle(p.id, a); acted = true; break; }
      }
    }
    if (!acted) { now = g.nextDeadline(); assert(g.timeout(), 'timeout senza effetto: stallo'); }
    check(g, total);
    for (const p of g.players) { const v = g.view(p.id); for (const q of v.players) assert(!('hand' in q), 'mano altrui esposta'); }
  }
  assert(g.over, 'partita non conclusa');
  return { turns: g.turn, steps, rejected, winnerSeat: g.p(g.winner).seat };
}

const N = +process.argv[2] || 200;
for (const fuzz of [false, true]) {
  for (const n of [3, 4, 6]) {
    const res = Array.from({ length: N }, () => play(n, fuzz));
    const turns = res.map(r => r.turns).sort((a, b) => a - b);
    const seats = Array(n).fill(0); res.forEach(r => seats[r.winnerSeat]++);
    console.log(`${fuzz ? 'fuzz' : 'bot '} ${n} giocatori: giri mediana ${turns[N >> 1]}, p90 ${turns[Math.floor(N * 0.9)]}, max ${turns[N - 1]}; vittorie per posto ${seats.join('/')}${fuzz ? `; azioni ostili respinte ${res.reduce((s, r) => s + r.rejected, 0)}` : ''}`);
  }
}
console.log('OK');
