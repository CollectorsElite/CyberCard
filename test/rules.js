'use strict';
// Regole di dettaglio: dotazione a livello 1, Sfighe in combattimento, Blue Teamer, Sysadmin, battute senza bis.
const assert = require('assert');
const { Game } = require('../server/game');
const { QUIPS, ROLES } = require('../server/cards');

function setup(n = 3) {
  let now = 1000;
  const g = new Game(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'G' + i })), { now: () => now });
  return g;
}
// prende una carta dal mazzo Ticket o, se è già stata distribuita, dalla mano di chi ce l'ha
const take = (g, pred) => {
  for (const pile of [g.decks.T, ...g.players.map(p => p.hand)]) { const i = pile.findIndex(pred); if (i >= 0) return pile.splice(i, 1)[0]; }
  assert.fail('carta non trovata');
};
const endTurn = g => { const p = g.current; if (g.phase === 'open') g.phase = 'end'; g.handle(p.id, { type: 'endTurn', discard: g.autoDiscard(p) }); };

// 1. Dotazione: a livello 1 si pesca un Asset a inizio turno; dal livello 2 non più
{
  const g = setup(), first = g.current;
  assert.strictEqual(first.hand.length, 6, 'il primo di turno, a livello 1, parte con la dotazione');
  assert.strictEqual(first.hand.filter(c => c.deck === 'A').length, 3);
  endTurn(g);
  const second = g.current;
  assert.strictEqual(second.hand.filter(c => c.deck === 'A').length, 3);
  endTurn(g);
  const third = g.current; // ancora a mano iniziale: 5 carte + dotazione
  assert.strictEqual(third.hand.length, 6);
  endTurn(g);
  first.level = 2;
  const before = g.current.hand.length;
  assert.strictEqual(g.current, first);
  assert.strictEqual(before, first.hand.length);
  const a = first.hand.filter(c => c.deck === 'A').length;
  endTurn(g); endTurn(g); endTurn(g);
  assert.strictEqual(g.current, first);
  assert.strictEqual(first.hand.filter(c => c.deck === 'A').length, a, 'dal livello 2 niente dotazione');
}

// 2. Una Sfiga su chi combatte, a finestra aperta, riapre il giro dei «passo»
{
  const g = setup(), f = g.players[0], s = g.players[1], o = g.players[2];
  const threat = take(g, c => c.type === 'threat' && c.l === 1);
  const curse = take(g, c => c.type === 'curse' && c.bad[0].k === 'penalty');
  s.hand.push(curse); f.level = 3;
  g.startCombat(f, [threat]);
  g.handle(f.id, { type: 'fight' });
  g.handle(f.id, { type: 'pass' }); g.handle(o.id, { type: 'pass' });
  assert(g.cWinning());
  g.handle(s.id, { type: 'curse', card: curse.uid, target: f.id });
  assert.strictEqual(g.combat.passes.size, 0, 'chi combatte deve poter rispondere alla Sfiga');
  assert(g.needs().includes(f.id));
  // su un giocatore estraneo al combattimento non riapre nulla
  const c2 = take(g, c => c.type === 'curse' && c.bad[0].k === 'penalty'); s.hand.push(c2);
  g.handle(f.id, { type: 'pass' });
  g.handle(s.id, { type: 'curse', card: c2.uid, target: o.id });
  assert.strictEqual(g.combat.passes.size, 1);
}

// 3. Blue Teamer: blocca la prima Sfiga giocata da un avversario, non quella pescata aprendo un ticket
{
  const g = setup(), b = g.players[0], s = g.players[1];
  b.role = take(g, c => c.type === 'role' && c.role === 'blue'); b.blueUsed = false;
  const c1 = take(g, c => c.type === 'curse' && c.bad[0].k === 'penalty');
  g.applyCurse(b, c1, null);
  assert(b.penalty > 0 && !b.blueUsed, 'la Sfiga da ticket non viene bloccata e non consuma il blocco');
  const before = b.penalty, c2 = take(g, c => c.type === 'curse' && c.bad[0].k === 'penalty'), c3 = take(g, c => c.type === 'curse' && c.bad[0].k === 'penalty');
  g.applyCurse(b, c2, s);
  assert.strictEqual(b.penalty, before, 'la prima Sfiga di un avversario è bloccata');
  assert.strictEqual(s.esp, 1, 'chi la gioca prende comunque Esposizione');
  g.applyCurse(b, c3, s);
  assert(b.penalty > before, 'la seconda nello stesso giro passa');
  assert.strictEqual(ROLES.blue.text.includes('avversario'), true);
}

// 4. Sysadmin: fugge con 3 o più; gli altri con 5 o più
{
  for (const [role, need] of [['sys', 3], [null, 5]]) {
    for (let roll = 1; roll <= 6; roll++) {
      const g = setup(), f = g.players[0];
      if (role) f.role = take(g, c => c.type === 'role' && c.role === role);
      const threat = { deck: 'T', type: 'threat', name: 'Minaccia di prova', l: 10, tr: 1, lv: 1, bad: [{ k: 'lvl', n: 1 }], d: '', vs: null, flee: 0, uid: 99999 };
      f.level = 5;
      g.startCombat(f, [threat]); g.combat.step = 'flee';
      g.rng = () => roll - 1;
      g.handle(f.id, { type: 'flee' });
      assert.strictEqual(f.level === 5, roll >= need, `${role || 'nessun ruolo'}, dado ${roll}`);
    }
  }
}

// 5. Battute: nessun bis consecutivo, e ogni tipo esce per intero prima di ripetersi
{
  const g = setup();
  for (const kind of ['win', 'loot', 'helpNo', 'counterNo']) {
    const n = QUIPS[kind].length, seen = [];
    for (let i = 0; i < n * 5; i++) seen.push(g.quip(kind));
    for (let i = 1; i < seen.length; i++) assert.notStrictEqual(seen[i], seen[i - 1], `bis consecutivo in ${kind}`);
    for (let k = 0; k < 5; k++) assert.strictEqual(new Set(seen.slice(k * n, k * n + n)).size, n, `${kind}: sacchetto incompleto`);
  }
  for (const [k, a] of Object.entries(QUIPS)) {
    assert(a.length >= 2 && new Set(a).size === a.length, `battute doppie o troppo poche in ${k}`);
    for (const q of a) assert(!/^«|»$/.test(q) && q.length <= 100, `battuta fuori formato in ${k}: ${q}`);
  }
}

console.log('OK rules');
