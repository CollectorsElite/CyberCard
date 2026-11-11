'use strict';
// Analisi di bilanciamento: partite tra bot con seme fisso e contatori agganciati al motore.
// Non fa parte di `npm test`: si lancia a mano dopo aver cambiato carte o regole, per confrontare prima e dopo.
// uso: node test/balance.js [partite] [giocatori separati da virgola] [--cards]
//      es. node test/balance.js 2000 3,4,6 --cards
// I bot giocano in modo semplice: i numeri servono a confrontare due versioni, non a prevedere un tavolo di persone.
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const N = +args[0] || 1000;
const PL = (args[1] || '3,4,5,6').split(',').map(Number);
const SHOW_CARDS = process.argv.includes('--cards');
const { Game } = require('../server/game');
const { decide } = require('../server/bots');

function rngFrom(seed) { let a = seed >>> 0; return n => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return Math.floor(((t ^ t >>> 14) >>> 0) / 4294967296 * n); }; }
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';
const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

let S; // contatori della configurazione corrente
let G; // partita corrente
const P = Game.prototype, orig = {};
function wrap(name, fn) { orig[name] = P[name]; P[name] = function (...a) { return fn.call(this, orig[name].bind(this), ...a); }; }
let ctx = null;
wrap('a_openTicket', function (o, p) {
  o(p);
  const c = this.combat ? this.combat.threats[0].card : this.revealed && this.revealed.card;
  if (c) inc(S.open, c.type);
  G.pturns++;
});
wrap('startTurn', function (o) {
  o();
  const p = this.current;
  if (this.turn > 3) { S.prAll++; if (!Object.values(p.gear).some(Boolean)) S.prNoGear++; if (this.basePower(p) <= 2) S.prWeak++; }
});
wrap('a_trouble', function (o, p, a) { o(p, a); S.trouble++; });
wrap('a_loot', function (o, p) { o(p); S.loot++; });
wrap('startCombat', function (o, f, cards) {
  o(f, cards);
  const c = this.combat; c._lvl = f.level; c._pow = this.basePower(f) - f.penalty; c._sab = 0; c._mp = f.level + cards[0].lv >= 10;
  S.combats++;
  if (c._mp) { S.mpTry++; G.mpTry++; }
  const t = S.threat[cards[0].name] || (S.threat[cards[0].name] = { l: cards[0].l, n: 0, win: 0, flee: 0, caught: 0, lvlSum: 0, margin: 0 });
  t.n++; t.lvlSum += f.level; t.margin += c._pow - cards[0].l;
  inc(S.combatByLevel, f.level);
});
wrap('sabotage', function (o, p, txt, card) { this.combat._sab++; S.sab++; inc(S.sabCard, card.name); G.sab++; o(p, txt, card); });
wrap('resolveWin', function (o, c) {
  const f = this.fighter(c), b = f.level;
  o(c);
  S.wins++; if (c.helper) S.winHelped++; if (c._sab) S.winDespiteSab++;
  S.threat[c.threats[0].card.name].win++;
  inc(S.winByLevel, c._lvl);
  S.lvGain.combat += f.level - b;
  if (c._mp) S.mpWin++;
  if (c.threats.length > 1) S.multiWin++;
});
wrap('a_flee', function (o, p) {
  const c = this.combat, names = c.threats.map(t => t.card.name), b = p.level;
  S.fleeCombats++; if (c._sab) S.lostToSab++;
  ctx = 'flee';
  const seqBefore = this.seq;
  o(p);
  ctx = null;
  for (const l of this.logs) if (l.i > seqBefore && /tenta la fuga/.test(l.t)) { const ok = /scappa/.test(l.t); S.fleeRolls++; if (ok) S.fleeOk++; const nm = names.find(n => l.t.includes(n)); if (nm && S.threat[nm]) S.threat[nm][ok ? 'flee' : 'caught']++; }
});
wrap('a_rollback', function (o, p, a) { o(p, a); S.rollback++; });
wrap('applyBad', function (o, p, effects) {
  const b = p.level; o(p, effects);
  if (b > p.level) S.lvLoss[ctx || 'other'] = (S.lvLoss[ctx || 'other'] || 0) + (b - p.level);
});
wrap('applyCurse', function (o, t, card, by) {
  const prev = ctx; ctx = by && by !== t ? 'curseOther' : 'curseSelf';
  if (ctx === 'curseOther') { S.cursePlayed++; inc(S.curseCard, card.name); if (this.combat && (this.combat.fighter === t.id)) S.curseInCombat++; } else S.curseSelf++;
  const blockedBefore = t.blueUsed;
  o(t, card, by);
  if (!blockedBefore && t.blueUsed) S.blueBlock++;
  ctx = prev;
});
wrap('addEsp', function (o, p) { const b = p.level, e = p.esp; o(p); if (p.esp < e) { S.audit++; G.audit++; S.lvLoss.audit += b - p.level; } });
wrap('a_levelUp', function (o, p, a) { o(p, a); S.lvGain.card++; });
wrap('a_sell', function (o, p, a) { const b = p.level; o(p, a); S.sells++; S.lvGain.credit += p.level - b; });
wrap('a_askHelp', function (o, p, a) { o(p, a); S.helpAsk++; });
wrap('a_counterHelp', function (o, p, a) { o(p, a); S.helpCounter++; });
wrap('a_answerHelp', function (o, p, a) { o(p, a); if (a.accept) S.helpYes++; });
wrap('a_play', function (o, p, a) {
  const card = p.hand.find(x => x.uid === a.card), c = this.combat;
  o(p, a);
  if (card) { const self = c && (c.fighter === p.id || c.helper === p.id); inc(S.played, card.name + (card.type === 'oneshot' ? (a.side === 'f' ? ' [pro]' : ' [contro]') : self ? ' [pro]' : ' [contro]')); }
});
wrap('a_endTurn', function (o, p, a) {
  const ids = Array.isArray(a.discard) ? a.discard : [];
  for (const id of ids) { const c = p.hand.find(x => x.uid === id); if (c) { inc(S.dumped, c.type); inc(S.dumpedCard, c.name); } }
  o(p, a);
});
wrap('draw', function (o, k) { const empty = !this.decks[k].length && this.disc[k].length; const r = o(k); if (empty) inc(S.reshuffle, k); return r; });

function fresh() {
  return { games: 0, rounds: [], pturns: [], seatWin: {}, open: {}, trouble: 0, loot: 0, combats: 0, wins: 0, winHelped: 0, winDespiteSab: 0, multiWin: 0,
    fleeCombats: 0, lostToSab: 0, fleeRolls: 0, fleeOk: 0, rollback: 0, threat: {}, combatByLevel: {}, winByLevel: {},
    lvGain: { combat: 0, card: 0, credit: 0 }, lvLoss: { flee: 0, curseSelf: 0, curseOther: 0, audit: 0, other: 0 },
    sab: 0, sabCard: {}, cursePlayed: 0, curseSelf: 0, curseCard: {}, curseInCombat: 0, blueBlock: 0, audit: 0, sells: 0,
    helpAsk: 0, helpYes: 0, helpCounter: 0, played: {}, dumped: {}, dumpedCard: {}, reshuffle: {},
    mpTry: 0, mpWin: 0, mpPerGame: [], endgame: [], second: [], last: [], comeback: 0, roleEnd: {}, roleWin: {}, leadChanges: [],
    lvlAtRound: {}, prAll: 0, prNoGear: 0, prWeak: 0, slow10: 0 };
}

function play(n, seed) {
  let now = 0;
  const g = new Game(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'Giocatore' + i, isBot: true })), { now: () => now, rng: rngFrom(seed) });
  G = { pturns: 0, mpTry: 0, sab: 0, audit: 0 };
  let steps = 0, first9 = null, leader = null, changes = 0, midLeader = null, lastRound = 0;
  while (!g.over && steps++ < 60000) {
    let acted = false;
    for (const id of g.needs()) { const a = decide(g, id); if (a) { g.handle(id, a); acted = true; break; } }
    if (!acted) for (const p of g.players) { const a = decide(g, p.id); if (a) { g.handle(p.id, a); acted = true; break; } }
    if (!acted) { now = g.nextDeadline(); if (!g.timeout()) throw new Error('stallo'); }
    if (g.turn !== lastRound) {
      lastRound = g.turn;
      const top = Math.max(...g.players.map(p => p.level));
      (S.lvlAtRound[g.turn] || (S.lvlAtRound[g.turn] = [])).push(top);
      const lead = g.players.filter(p => p.level === top);
      if (lead.length === 1 && lead[0].id !== leader) { if (leader) changes++; leader = lead[0].id; }
      if (first9 === null && top >= 9) first9 = g.turn;
      if (g.turn === 8) midLeader = leader;
      if (g.turn === 10 && top <= 3) S.slow10++;
    }
  }
  if (!g.over) throw new Error('non conclusa');
  const w = g.p(g.winner);
  S.games++; S.rounds.push(g.turn); S.pturns.push(G.pturns);
  inc(S.seatWin, (w.seat - g.startSeat + n) % n);
  S.mpPerGame.push(G.mpTry);
  S.endgame.push(g.turn - (first9 === null ? g.turn : first9));
  const others = g.players.filter(p => p !== w).map(p => p.level).sort((a, b) => b - a);
  S.second.push(others[0]); S.last.push(others[others.length - 1]);
  if (midLeader && midLeader !== w.id) S.comeback++;
  S.leadChanges.push(changes);
  for (const p of g.players) { const r = p.role ? p.role.role : 'nessuno'; inc(S.roleEnd, r); if (p === w) inc(S.roleWin, r); }
  return g.turn;
}

for (const n of PL) {
  S = fresh();
  for (let i = 0; i < N; i++) play(n, 1000 * n + i);
  const g = S.games;
  console.log(`\n===== ${n} giocatori, ${g} partite =====`);
  console.log(`giri: p10 ${q(S.rounds, .1)}  mediana ${q(S.rounds, .5)}  p90 ${q(S.rounds, .9)}  p99 ${q(S.rounds, .99)}  max ${Math.max(...S.rounds)} | turni giocati mediana ${q(S.pturns, .5)}`);
  console.log(`vittorie per ordine di turno: ${Array.from({ length: n }, (_, i) => pct(S.seatWin[i] || 0, g)).join('  ')}`);
  const ot = Object.values(S.open).reduce((a, b) => a + b, 0);
  console.log(`ticket aperti: ${Object.entries(S.open).map(([k, v]) => `${k} ${pct(v, ot)}`).join(', ')} | dopo: cerca guai ${(S.trouble / g).toFixed(1)}/partita, analizza log ${(S.loot / g).toFixed(1)}/partita`);
  console.log(`combattimenti/partita ${(S.combats / g).toFixed(1)}: vinti ${pct(S.wins, S.combats)} (con aiuto ${pct(S.winHelped, S.wins)}, multi ${pct(S.multiWin, S.wins)}), persi ${pct(S.fleeCombats, S.combats)} (di cui per sabotaggio ${pct(S.lostToSab, S.fleeCombats)}), rollback ${(S.rollback / g).toFixed(2)}/partita; fughe riuscite ${pct(S.fleeOk, S.fleeRolls)}`);
  console.log(`vittoria per livello di chi combatte: ${Object.keys(S.combatByLevel).sort((a, b) => a - b).map(l => `L${l} ${pct(S.winByLevel[l] || 0, S.combatByLevel[l])}`).join('  ')}`);
  const lg = S.lvGain, ll = S.lvLoss, tg = lg.combat + lg.card + lg.credit;
  console.log(`livelli guadagnati/partita ${(tg / g).toFixed(1)}: combattimento ${pct(lg.combat, tg)}, carte livello ${pct(lg.card, tg)}, credito ${pct(lg.credit, tg)}`);
  const tl = Object.values(ll).reduce((a, b) => a + b, 0);
  console.log(`livelli persi/partita ${(tl / g).toFixed(1)}: fuga fallita ${pct(ll.flee, tl)}, sfiga da ticket ${pct(ll.curseSelf, tl)}, sfiga giocata da altri ${pct(ll.curseOther, tl)}, audit ${pct(ll.audit, tl)}`);
  console.log(`per partita: sabotaggi in combattimento ${(S.sab / g).toFixed(1)}, sfighe giocate ${(S.cursePlayed / g).toFixed(1)} (in combattimento ${(S.curseInCombat / g).toFixed(2)}), sfighe subite da ticket ${(S.curseSelf / g).toFixed(1)}, blocchi Blue ${(S.blueBlock / g).toFixed(2)}, audit ${(S.audit / g).toFixed(2)}, vendite ${(S.sells / g).toFixed(1)}`);
  console.log(`aiuto per partita: richieste ${(S.helpAsk / g).toFixed(2)}, controproposte ${(S.helpCounter / g).toFixed(2)}, accettate ${(S.helpYes / g).toFixed(2)}`);
  console.log(`match point: tentativi/partita ${(S.mpTry / g).toFixed(2)} (mediana ${q(S.mpPerGame, .5)}, p90 ${q(S.mpPerGame, .9)}), riusciti ${pct(S.mpWin, S.mpTry)} | giri dal primo livello 9 alla fine: mediana ${q(S.endgame, .5)}, p90 ${q(S.endgame, .9)}`);
  console.log(`a fine partita: secondo a livello medio ${avg(S.second).toFixed(1)} (>=8 nel ${pct(S.second.filter(x => x >= 8).length, g)}), ultimo ${avg(S.last).toFixed(1)}; il vincitore non era in testa al giro 8: ${pct(S.comeback, g)}; cambi al comando mediana ${q(S.leadChanges, .5)}`);
  const re = Object.values(S.roleEnd).reduce((a, b) => a + b, 0);
  console.log(`ruoli a fine partita (quota giocatori -> quota vincitori): ${Object.keys(S.roleEnd).sort().map(r => `${r} ${pct(S.roleEnd[r], re)}->${pct(S.roleWin[r] || 0, g)}`).join(', ')}`);
  console.log(`rimescolamenti/partita: Ticket ${((S.reshuffle.T || 0) / g).toFixed(2)}, Asset ${((S.reshuffle.A || 0) / g).toFixed(2)} | scarti per limite di mano/partita: ${Object.entries(S.dumped).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / g).toFixed(1)}`).join(', ')}`);
  console.log(`STALLO: turni (dopo il giro 3) iniziati senza asset equipaggiati ${pct(S.prNoGear, S.prAll)}, con forza <= 2 ${pct(S.prWeak, S.prAll)}; partite col primo ancora a livello <= 3 al giro 10: ${pct(S.slow10, g)}`);
  console.log(`livello del primo per giro: ${[2, 4, 6, 8, 10, 12, 15, 20].map(r => S.lvlAtRound[r] ? `g${r}:${avg(S.lvlAtRound[r]).toFixed(1)}` : '').join(' ')}`);
  if (SHOW_CARDS) {
    console.log('minacce (forza: incontri, vinte, fuga riuscita su fughe, livello medio di chi le incontra):');
    for (const [nm, t] of Object.entries(S.threat).sort((a, b) => a[1].l - b[1].l)) console.log(`  ${String(t.l).padStart(2)} ${nm.padEnd(46)} n=${String(t.n).padStart(5)} vinte ${pct(t.win, t.n).padStart(6)}  fuga ${pct(t.flee, t.flee + t.caught).padStart(6)}  liv ${(t.lvlSum / t.n).toFixed(1)}`);
    console.log('carte giocate in combattimento/partita:', Object.entries(S.played).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / g).toFixed(2)}`).join('; '));
    console.log('sfighe giocate/partita:', Object.entries(S.curseCard).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / g).toFixed(2)}`).join('; '));
    console.log('scartate per limite di mano/partita:', Object.entries(S.dumpedCard).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k} ${(v / g).toFixed(2)}`).join('; '));
  }
}
