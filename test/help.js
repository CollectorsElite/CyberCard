'use strict';
// Trattativa sull'aiuto: proposta, controproposte, limiti, scadenze e risposta dei bot.
const assert = require('assert');
const { Game } = require('../server/game');
const { decide } = require('../server/bots');

function setup(bots = false) {
  let now = 1000;
  const g = new Game(['Ada', 'Bruno', 'Carla'].map((name, i) => ({ id: 'p' + i, name, isBot: bots && i > 0 })), { now: () => now });
  const card = g.decks.T.find(c => c.type === 'threat' && c.tr >= 3 && c.lv === 1);
  g.decks.T.splice(g.decks.T.indexOf(card), 1);
  g.startCombat(g.p('p0'), [card]);
  return { g, tr: g.cTreasures(), tick: ms => { now += ms; } };
}
const fails = (fn, re) => assert.throws(fn, e => re.test(e.message), 'atteso errore ' + re);

// 1. proposta, controproposta dell'aiutante, accettazione di chi combatte
{
  const { g, tr } = setup(), c = g.combat;
  g.handle('p0', { type: 'askHelp', to: 'p1', share: 1 });
  assert.deepStrictEqual(c.offer, { from: 'p0', to: 'p1', share: 1, round: 0 });
  assert(g.needs().includes('p1'));
  fails(() => g.handle('p0', { type: 'counterHelp', share: 2 }), /Nessuna proposta/); // non tocca a lui
  fails(() => g.handle('p2', { type: 'counterHelp', share: 2 }), /Nessuna proposta/); // estraneo
  fails(() => g.handle('p1', { type: 'counterHelp', share: 1 }), /diversa/);
  for (const bad of [-1, tr + 1, 1.5, '2', null, undefined]) fails(() => g.handle('p1', { type: 'counterHelp', share: bad }), /controproposta deve/);
  g.handle('p1', { type: 'counterHelp', share: 2 });
  assert.deepStrictEqual(c.offer, { from: 'p1', to: 'p0', share: 2, round: 1 });
  assert(g.needs().includes('p0') && g.view('p2').combat.offer.canCounter);
  fails(() => g.handle('p1', { type: 'answerHelp', accept: true }), /Nessuna richiesta/); // non può accettarsi da solo
  g.handle('p0', { type: 'answerHelp', accept: true });
  assert.strictEqual(c.helper, 'p1', "l'aiutante è chi ha rilanciato, non chi combatte");
  assert.strictEqual(c.share, 2);
  assert.strictEqual(c.offer, null);
}

// 2. tetto alle controproposte, poi solo sì o no
{
  const { g } = setup(), c = g.combat;
  g.handle('p0', { type: 'askHelp', to: 'p1', share: 0 });
  g.handle('p1', { type: 'counterHelp', share: 3 });
  g.handle('p0', { type: 'counterHelp', share: 1 });
  g.handle('p1', { type: 'counterHelp', share: 2 });
  assert.strictEqual(c.offer.round, g.helpCounters);
  assert.strictEqual(g.view('p0').combat.offer.canCounter, false);
  fails(() => g.handle('p0', { type: 'counterHelp', share: 1 }), /limite/);
  g.handle('p0', { type: 'answerHelp', accept: false });
  assert.strictEqual(c.offer, null);
  assert.strictEqual(c.helper, null);
}

// 3. chi ha fatto l'ultima proposta può ritirarla; a tempo scaduto vale come rifiuto
{
  const { g, tick } = setup(), c = g.combat;
  g.handle('p0', { type: 'askHelp', to: 'p1', share: 1 });
  g.handle('p1', { type: 'counterHelp', share: 3 });
  fails(() => g.handle('p0', { type: 'cancelHelp' }), /Nessuna richiesta/);
  g.handle('p1', { type: 'cancelHelp' });
  assert.strictEqual(c.offer, null);
  g.handle('p0', { type: 'askHelp', to: 'p2', share: 1 });
  g.handle('p2', { type: 'counterHelp', share: 2 });
  const main = g.deadline;
  assert(main > c.offerDeadline, 'il timer del combattimento non deve scadere durante la trattativa');
  tick(c.offerDeadline - g.now() + 1);
  assert(g.timeout());
  assert.strictEqual(c.offer, null);
  assert.strictEqual(c.helper, null);
  assert.strictEqual(g.combat, c, 'il combattimento prosegue dopo la trattativa scaduta');
}

// 4. bot aiutante: rilancia con la sua cifra, poi accetta quando la ottiene
{
  const { g, tr } = setup(true), c = g.combat, b = g.p('p1');
  // forze truccate: p0 da solo perde, con p1 vince di 1 (così il bot è disposto ad aiutare)
  c.fBonus = c.threats[0].card.l;
  c.mBonus = c.fBonus + g.basePower(g.p('p0')) + g.basePower(b) - c.threats[0].card.l - 1;
  assert(!g.cWinning(c));
  g.handle('p0', { type: 'askHelp', to: 'p1', share: 0 });
  const a = decide(g, 'p1');
  assert.strictEqual(a.type, 'counterHelp');
  assert(a.share >= 1 && a.share <= tr);
  g.handle('p1', a);
  assert.strictEqual(decide(g, 'p1'), null, 'il bot aspetta la risposta alla sua controproposta');
  g.handle('p0', { type: 'counterHelp', share: a.share - 1 });
  assert.strictEqual(decide(g, 'p1').type, 'counterHelp', 'sotto la sua cifra il bot rilancia ancora');
  g.handle('p1', decide(g, 'p1'));
  g.handle('p0', { type: 'answerHelp', accept: true });
  assert.strictEqual(c.helper, 'p1');
  assert.strictEqual(c.share, a.share);
}

// 5. bot che combatte: accetta un rilancio entro il suo limite
{
  const { g, tr } = setup(true), c = g.combat;
  c.fighter = 'p1'; // combatte il bot, p0 (umano) viene chiamato in aiuto
  g.handle('p1', { type: 'askHelp', to: 'p0', share: 1 });
  g.handle('p0', { type: 'counterHelp', share: 2 });
  assert.deepStrictEqual(decide(g, 'p1'), { type: 'answerHelp', accept: true });
  g.handle('p1', { type: 'answerHelp', accept: true });
  assert.strictEqual(c.helper, 'p0');
  assert.strictEqual(c.share, 2);
  assert(tr >= 3);
}

console.log('OK help');
