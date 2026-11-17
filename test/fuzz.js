'use strict';
// Fuzzing a tappeto: a ogni passo prova tutte le azioni possibili di tutti i giocatori (ogni carta, lato, bersaglio)
// e ne esegue una a caso tra quelle accettate; metà delle volte gioca invece un bot, la cui scelta deve essere sempre valida.
// Controlla conservazione delle carte, limiti di livello/esposizione/credito, coerenza del combattimento, viste senza mani altrui.
// uso: node test/fuzz.js [partite] [seme iniziale]
const assert = require('assert');
const R = require('path').join(__dirname, '..', 'server') + '/';
const { Game, GameError } = require(R + 'game');
const { decide } = require(R + 'bots');
function rngFrom(seed){let a=seed>>>0;return n=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return Math.floor(((t^t>>>14)>>>0)/4294967296*n);};}
const uids = g => { const ids = []; const push = c => c && ids.push(c.uid);
  g.decks.T.forEach(push); g.decks.A.forEach(push); g.disc.T.forEach(push); g.disc.A.forEach(push);
  for (const p of g.players) { p.hand.forEach(push); Object.values(p.gear).forEach(push); push(p.role); }
  if (g.combat) g.combat.threats.forEach(t => { if (!t.copy) push(t.card); }); return ids; };
function check(g, total, ctx) {
  const ids = uids(g);
  assert.strictEqual(new Set(ids).size, ids.length, 'carta duplicata ' + ctx);
  assert.strictEqual(ids.length, total, `carte perse ${ids.length}/${total} ` + ctx);
  for (const p of g.players) {
    assert(Number.isInteger(p.level) && p.level >= 1 && p.level <= 10, 'livello ' + p.level + ' ' + ctx);
    assert(p.esp >= 0 && p.esp < 4, 'esp ' + ctx);
    assert(p.credit >= 0, 'credito negativo ' + ctx);
    assert(p.penalty >= 0, 'penalità negativa ' + ctx);
    for (const [s, gr] of Object.entries(p.gear)) if (gr) assert(gr.type === 'gear' && gr.slot === s, 'slot ' + ctx);
    if (p.role) assert.strictEqual(p.role.type, 'role', 'ruolo ' + ctx);
    for (const c of p.hand) assert(c && c.uid != null, 'mano ' + ctx);
  }
  if (g.over) assert(g.winner && g.players.find(p => p.id === g.winner).level === 10, 'vincitore ' + ctx);
  else assert(!g.players.some(p => p.level >= 10), 'livello 10 senza fine partita ' + ctx);
  const c = g.combat;
  if (c) {
    assert(g.players.find(p => p.id === c.fighter), 'fighter ' + ctx);
    assert(c.helper !== c.fighter, 'helper=fighter ' + ctx);
    assert(c.threats.length >= 1, 'nessuna minaccia ' + ctx);
    assert(['prep', 'window', 'flee'].includes(c.step), 'step ' + c.step + ' ' + ctx);
    assert(Number.isFinite(g.cFighterPower(c)) && Number.isFinite(g.cThreatPower(c)), 'forza NaN ' + ctx);
  }
  for (const p of g.players) {
    const v = g.view(p.id); // non deve esplodere
    assert(v.hand.every(h => p.hand.some(x => x.uid === h.uid)), 'mano altrui nella vista ' + ctx);
    assert(!JSON.stringify(v.players).includes('"hand":['), 'mani altrui esposte ' + ctx);
  }
}
// tutte le azioni candidate di un giocatore
function candidates(g, p) {
  const ids = g.players.map(x => x.id), out = [];
  const simple = ['openTicket', 'loot', 'fight', 'pass', 'flee', 'cancelHelp', 'dropRole'];
  simple.forEach(t => out.push({ type: t }));
  out.push({ type: 'endTurn', discard: g.autoDiscard(p) });
  out.push({ type: 'answerHelp', accept: true }, { type: 'answerHelp', accept: false });
  for (const s of [0, 1, 2, 3]) out.push({ type: 'counterHelp', share: s });
  for (const to of ids) for (const s of [0, 1, 2]) out.push({ type: 'askHelp', to, share: s });
  for (const sl of ['hw', 'sw', 'cr', 'gd']) out.push({ type: 'unequip', slot: sl });
  for (const sl of ['hw', 'sw', 'cr', 'gd']) { const gr = p.gear[sl]; if (gr) out.push({ type: 'sell', card: gr.uid }); }
  for (const c of p.hand) {
    const u = c.uid;
    ['trouble', 'equip', 'takeRole', 'levelUp', 'sell', 'discard', 'rollback'].forEach(t => out.push({ type: t, card: u }));
    for (const side of ['f', 'm']) out.push({ type: 'play', card: u, side });
    out.push({ type: 'play', card: u });
    for (const th of p.hand) if (th.type === 'threat') out.push({ type: 'play', card: u, threat: th.uid });
    for (const t of ids) out.push({ type: 'curse', card: u, target: t });
    out.push({ type: 'trick', card: u });
    for (const side of ['f', 'm']) out.push({ type: 'trick', card: u, side });
    for (const t of ids) out.push({ type: 'trick', card: u, target: t });
  }
  return out;
}
const stats = { games: 0, steps: 0, acts: {}, tricks: {}, over: 0, maxSteps: 0, errors: [] };
function game(seed, n) {
  let now = 0;
  const rng = rngFrom(seed), rnd = k => rng(k);
  const g = new Game(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, isBot: false })), { now: () => now, rng: rngFrom(seed * 7 + 1) });
  const total = uids(g).length; let steps = 0, idle = 0;
  while (!g.over && steps < 6000) {
    steps++;
    // a volte lascia scadere il tempo, come farebbe un giocatore assente
    if (rnd(100) < 4) { now = g.nextDeadline(); g.timeout(); check(g, total, `seed ${seed} timeout`); continue; }
    const order = g.players.map(p => p).sort(() => rnd(3) - 1);
    let done = false;
    // metà delle volte gioca un bot: la sua scelta deve essere sempre accettata dal motore
    if (rnd(2) === 0) for (const p of order) {
      let a; try { a = decide(g, p.id); } catch (e) { stats.errors.push(`seed ${seed} decide esplode: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); break; }
      if (!a) continue;
      try { g.handle(p.id, a); done = true; stats.bot = (stats.bot || 0) + 1; }
      catch (e) { stats.botBad = stats.botBad || {}; const k = a.type + (a.type === 'trick' ? ':' + ((p.hand.find(x => x.uid === a.card) || {}).fx) : '') + ' -> ' + e.message; stats.botBad[k] = (stats.botBad[k] || 0) + 1; if (!(e instanceof GameError)) stats.errors.push('bot: ' + e.stack); }
      break;
    }
    for (const p of order) {
      const cs = candidates(g, p);
      for (let k = 0; k < 40 && !done; k++) {
        const a = cs[rnd(cs.length)];
        const before = JSON.stringify([g.version, g.phase, g.cur]);
        try { g.handle(p.id, a); done = true; stats.acts[a.type] = (stats.acts[a.type] || 0) + 1;
          if (a.type === 'trick') { const fx = (g.disc.T.concat(g.disc.A).find(c => c.uid === a.card) || {}).fx; stats.tricks[fx] = (stats.tricks[fx] || 0) + 1; } }
        catch (e) { if (!(e instanceof GameError)) { stats.errors.push(`seed ${seed} ${JSON.stringify(a)}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); done = true; } }
      }
      if (done) break;
    }
    if (!done) { idle++; now = g.nextDeadline(); g.timeout(); } else idle = 0;
    assert(idle < 50, 'stallo seed ' + seed);
    check(g, total, `seed ${seed} step ${steps}`);
  }
  stats.games++; stats.steps += steps; stats.maxSteps = Math.max(stats.maxSteps, steps); if (g.over) stats.over++;
}
const N = +process.argv[2] || 200;
for (let s = +process.argv[3] || 1; s < (+process.argv[3] || 1) + N; s++) {
  try { game(s, 3 + (s % 4)); } catch (e) { console.log('FALLITO', e.message); stats.errors.push(e.message); if (stats.errors.length > 5) break; }
}
const bad = stats.errors.length || stats.botBad;
if (bad) { console.error('FALLITO', JSON.stringify({ errori: stats.errors.slice(0, 8), botRifiutate: stats.botBad })); process.exit(1); }
console.log(`OK fuzz (${stats.games} partite, ${stats.bot} mosse dei bot, nessuna rifiutata)`);
