'use strict';
// Carte speciali e nuove penalità: ticket non-minaccia in mano, turno saltato, Honeypot, Change freeze,
// reperibilità, capro espiatorio, risposta automatica, riassegnazione, falso positivo, IA, riavvio.
const assert = require('assert');
const { Game, GameError } = require('../server/game');

function setup(n = 3) {
  let now = 1000;
  return new Game(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'G' + i })), { now: () => now });
}
const piles = g => [g.decks.T, g.decks.A, ...g.players.map(p => p.hand)];
const take = (g, pred) => {
  for (const pile of piles(g)) { const i = pile.findIndex(pred); if (i >= 0) return pile.splice(i, 1)[0]; }
  assert.fail('carta non trovata');
};
// mette in mano a p una carta che soddisfa pred, mai la stessa due volte (take cerca anche nelle mani)
const given = new WeakSet();
const give = (g, p, pred) => { const c = take(g, x => pred(x) && !given.has(x)); given.add(c); p.hand.push(c); return c; };
const trick = fx => c => c.type === 'trick' && c.fx === fx;
const threat = (l, extra = {}) => ({ deck: 'T', type: 'threat', name: 'Minaccia di prova ' + l, l, tr: 2, lv: 1, bad: [{ k: 'lvl', n: 1 }], bt: '', d: '', vs: null, flee: 0, uid: 90000 + l, ...extra });
const refuses = (fn, what) => assert.throws(fn, GameError, what);
// combattimento a finestra aperta: f combatte, gli altri sono i primi due del tavolo
function fight(g, f, card) { g.startCombat(f, [card]); g.handle(f.id, { type: 'fight' }); return g.combat; }

// 1. Aprendo un ticket solo le Minacce si affrontano: una Sfiga va in mano e non fa effetto
{
  const g = setup(), p = g.current;
  const curse = take(g, c => c.type === 'curse' && c.bad[0].k === 'lvl');
  g.decks.T.push(curse); p.level = 5;
  const before = p.hand.length;
  g.handle(p.id, { type: 'openTicket' });
  assert.strictEqual(p.level, 5, 'la Sfiga pescata non si subisce');
  assert(p.hand.includes(curse) && p.hand.length === before + 1, 'la Sfiga pescata va in mano');
  assert.strictEqual(g.phase, 'after');
  assert(!g.disc.T.includes(curse), 'e non finisce negli scarti');
}

// 2. Turno saltato: il segnalino si consuma e il turno passa a chi viene dopo
{
  const g = setup(), a = g.current, b = g.players[(a.seat + 1) % 3], c = g.players[(a.seat + 2) % 3];
  g.applyBad(b, [{ k: 'skip' }]);
  assert(g.view(a.id).players.find(x => x.id === b.id).skip, 'il segnalino è visibile a tutti');
  g.phase = 'end';
  g.handle(a.id, { type: 'endTurn', discard: g.autoDiscard(a) });
  assert.strictEqual(g.current, c, 'chi deve saltare viene saltato');
  assert.strictEqual(b.skip, false);
  g.phase = 'end'; g.handle(c.id, { type: 'endTurn', discard: g.autoDiscard(c) });
  g.phase = 'end'; g.handle(a.id, { type: 'endTurn', discard: g.autoDiscard(a) });
  assert.strictEqual(g.current, b, 'al giro dopo gioca regolarmente');
}

// 3. Honeypot: annulla l'ultimo sabotaggio e chi l'aveva giocato prende un punto di Esposizione in più
{
  const g = setup(), [f, s] = g.players;
  f.level = 6;
  const boost = give(g, s, c => c.type === 'boost' && c.amt === 10), hp = give(g, f, trick('honeypot'));
  const c = fight(g, f, threat(4));
  assert(g.cWinning());
  refuses(() => g.handle(f.id, { type: 'trick', card: hp.uid }), 'senza sabotaggi non c\'è niente da annullare');
  g.handle(s.id, { type: 'play', card: boost.uid });
  assert(!g.cWinning() && s.esp === 1 && c.threats[0].trMod === 2);
  g.handle(f.id, { type: 'trick', card: hp.uid });
  assert(g.cWinning() && c.threats[0].mod === 0 && c.threats[0].trMod === 0, 'il sabotaggio è annullato');
  assert.strictEqual(s.esp, 2, '+1 Esposizione in più a chi aveva sabotato');
  assert.strictEqual(c.passes.size, 0, 'riapre il giro dei passo');
}

// 4. Change freeze: da quel momento niente carte, Sfighe sui combattenti o richieste di aiuto; non vale a match point
{
  const g = setup(), [f, s, o] = g.players;
  f.level = 5;
  const fr = give(g, f, trick('freeze')), shot = give(g, s, c => c.type === 'oneshot' && !c.escape), curse = give(g, s, c => c.type === 'curse');
  refuses(() => { g.startCombat(f, [threat(3)]); g.handle(f.id, { type: 'trick', card: fr.uid }); }, 'solo a finestra aperta');
  g.handle(f.id, { type: 'fight' });
  g.handle(f.id, { type: 'trick', card: fr.uid });
  assert(g.combat.frozen && g.view(s.id).combat.frozen);
  refuses(() => g.handle(s.id, { type: 'play', card: shot.uid, side: 'm' }), 'niente carte');
  refuses(() => g.handle(s.id, { type: 'curse', card: curse.uid, target: f.id }), 'niente Sfighe su chi combatte');
  refuses(() => g.handle(f.id, { type: 'askHelp', to: o.id, share: 0 }), 'niente aiuto');
  g.handle(s.id, { type: 'curse', card: curse.uid, target: o.id }); // su un estraneo al combattimento si può
  for (const p of g.players) g.handle(p.id, { type: 'pass' });
  assert(!g.combat && f.level === 6, 'il combattimento si chiude com\'era');

  const g2 = setup(), [f2, s2] = g2.players;
  f2.level = 9;
  const fr2 = give(g2, f2, trick('freeze'));
  fight(g2, f2, threat(2));
  refuses(() => g2.handle(f2.id, { type: 'trick', card: fr2.uid }), 'a match point non vale');
  assert(f2.hand.includes(fr2), 'la carta rifiutata resta in mano');
  assert(s2);
}

// 5. «Hai un minuto?» porta via l'aiutante; l'Honeypot lo riporta
{
  const g = setup(), [f, s, h] = g.players;
  f.level = 2; h.level = 6;
  const po = give(g, s, trick('poach')), hp = give(g, f, trick('honeypot'));
  const c = fight(g, f, threat(6));
  refuses(() => g.handle(s.id, { type: 'trick', card: po.uid }), 'senza aiutante non si gioca');
  g.handle(f.id, { type: 'askHelp', to: h.id, share: 1 });
  g.handle(h.id, { type: 'answerHelp', accept: true });
  assert(g.cWinning() && c.helper === h.id);
  g.handle(s.id, { type: 'trick', card: po.uid });
  assert(!c.helper && !g.cWinning() && s.esp === 1, 'aiutante portato via: è un sabotaggio');
  g.handle(f.id, { type: 'trick', card: hp.uid });
  assert(c.helper === h.id && c.share === 1 && g.cWinning(), 'l\'Honeypot riporta l\'aiutante e l\'accordo');
}

// 6. Turno di reperibilità: aiuto forzato e gratuito
{
  const g = setup(), [f, , h] = g.players;
  f.level = 2; h.level = 6;
  const oc = give(g, f, trick('oncall'));
  const c = fight(g, f, threat(6));
  g.handle(f.id, { type: 'trick', card: oc.uid, target: h.id });
  assert(c.helper === h.id && c.share === 0 && g.cWinning());
  const hand = h.hand.length;
  for (const p of g.players) g.handle(p.id, { type: 'pass' });
  assert.strictEqual(f.level, 3);
  assert.strictEqual(h.hand.length, hand, 'chi è di reperibilità non incassa niente');
}

// 7. Capro espiatorio: se ti prendono paga un altro; un Blue Teamer con lo scudo rimanda tutto al mittente
{
  for (const blue of [false, true]) {
    const g = setup(), [f, v] = g.players;
    f.level = 4; v.level = 4;
    if (blue) { v.role = take(g, c => c.type === 'role' && c.role === 'blue'); v.blueUsed = false; }
    const sg = give(g, f, trick('scapegoat'));
    g.startCombat(f, [threat(12)]); g.combat.step = 'flee';
    refuses(() => g.handle(v.id, { type: 'trick', card: sg.uid, target: f.id }), 'solo chi fugge');
    g.rng = () => 0; // dado 1: preso
    g.handle(f.id, { type: 'trick', card: sg.uid, target: v.id });
    assert(!g.combat);
    assert.strictEqual(f.esp, 1, 'scaricare la colpa lascia tracce');
    assert.strictEqual(f.level, blue ? 3 : 4, blue ? 'bloccato: paga chi ha provato' : 'chi fugge non paga');
    assert.strictEqual(v.level, blue ? 4 : 3, blue ? 'il Blue Teamer è salvo' : 'paga il capro espiatorio');
  }
}

// 8. Risposta automatica: la prima Sfiga torna al mittente, poi si spegne; scade al proprio turno
{
  const g = setup(), a = g.current, b = g.players[(a.seat + 1) % 3];
  a.level = 5; b.level = 5;
  const ooo = give(g, a, trick('ooo'));
  const c1 = give(g, b, c => c.type === 'curse' && c.bad[0].k === 'lvl'), c2 = give(g, b, c => c.type === 'curse' && c.bad[0].k === 'lvl');
  g.handle(a.id, { type: 'trick', card: ooo.uid });
  assert(a.ooo && g.view(b.id).players.find(x => x.id === a.id).ooo);
  g.handle(b.id, { type: 'curse', card: c1.uid, target: a.id });
  assert(a.level === 5 && b.level === 4 && !a.ooo && b.esp === 1, 'la Sfiga torna a chi l\'ha giocata');
  g.handle(b.id, { type: 'curse', card: c2.uid, target: a.id });
  assert.strictEqual(a.level, 4, 'la seconda passa');
  a.ooo = true;
  for (let i = 0; i < 3; i++) { const p = g.current; g.phase = 'end'; g.handle(p.id, { type: 'endTurn', discard: g.autoDiscard(p) }); }
  assert(g.current === a && !a.ooo, 'al proprio turno la Risposta automatica si spegne');
}

// 9. Riassegnazione: il combattimento passa a un altro, con premi e penalità; il turno resta a chi l'ha scaricato
{
  const g = setup(), a = g.current, b = g.players[(a.seat + 1) % 3];
  a.level = 2; b.level = 8;
  const ra = give(g, a, trick('reassign')), ra2 = give(g, b, trick('reassign'));
  g.phase = 'after';
  g.startCombat(a, [threat(5)]);
  g.handle(a.id, { type: 'trick', card: ra.uid, target: b.id });
  const c = g.combat;
  assert(c.fighter === b.id && c.step === 'prep' && a.esp === 1);
  assert.deepStrictEqual(g.needs(), [b.id]);
  refuses(() => g.handle(b.id, { type: 'trick', card: ra2.uid, target: a.id }), 'una sola riassegnazione per ticket');
  g.handle(b.id, { type: 'fight' });
  for (const p of g.players) g.handle(p.id, { type: 'pass' });
  assert.strictEqual(b.level, 9, 'vince chi ha ereditato il ticket');
  assert(g.current === a && g.phase === 'end', 'il turno resta a chi l\'aveva aperto');
}

// 10. Falso positivo: annulla tutto; contro una vittoria altrui è sabotaggio; non ferma un match point
{
  const g = setup(), [f, s] = g.players;
  f.level = 5;
  const fp = give(g, s, trick('falsepos'));
  fight(g, f, threat(3));
  const hand = f.hand.length;
  g.handle(s.id, { type: 'trick', card: fp.uid });
  assert(!g.combat && f.level === 5 && f.hand.length === hand && s.esp === 1 && g.phase === 'end');

  const g2 = setup(), [f2, s2] = g2.players;
  f2.level = 9;
  const fp2 = give(g2, s2, trick('falsepos')), own = give(g2, f2, trick('falsepos'));
  fight(g2, f2, threat(20));
  refuses(() => g2.handle(s2.id, { type: 'trick', card: fp2.uid }), 'un estraneo non annulla un match point');
  g2.handle(f2.id, { type: 'trick', card: own.uid }); // chi combatte può sempre sfilarsi
  assert(!g2.combat && f2.level === 9 && f2.esp === 0);
}

// 11. Chiedo all'IA: 1 allucina (−3), 2-5 il numero uscito, 6 vale +8
{
  for (const [roll, amt] of [[1, -3], [2, 2], [5, 5], [6, 8]]) {
    const g = setup(), [f, s] = g.players;
    f.level = 5;
    const ai = give(g, s, trick('ai'));
    const c = fight(g, f, threat(3));
    g.rng = () => roll - 1;
    g.handle(s.id, { type: 'trick', card: ai.uid, side: 'm' });
    assert.strictEqual(c.mBonus, amt, `dado ${roll}`);
    assert.strictEqual(s.esp, 1, 'contro un altro è comunque un sabotaggio');
    assert.strictEqual(!!c.lastSab, amt > 0, 'l\'Honeypot annulla solo un sabotaggio riuscito');
  }
}

// 12. Spegni e riaccendi: azzera bonus e interferenze, restano le minacce entrate
{
  const g = setup(), [f, s] = g.players;
  f.level = 5;
  const boost = give(g, s, c => c.type === 'boost' && c.amt === 10), shot = give(g, f, c => c.type === 'oneshot' && !c.escape), rb = give(g, f, trick('reboot'));
  const c = fight(g, f, threat(4));
  g.handle(f.id, { type: 'play', card: shot.uid, side: 'f' });
  g.handle(s.id, { type: 'play', card: boost.uid });
  assert(!g.cWinning());
  g.handle(f.id, { type: 'trick', card: rb.uid });
  assert(c.fBonus === 0 && c.mBonus === 0 && c.threats[0].mod === 0 && c.threats[0].trMod === 0 && g.cWinning() && !c.lastSab);
}

// 13. Priorità dal CEO: più forza, ma un livello in più in palio
{
  const g = setup(), [f] = g.players;
  f.level = 6;
  const ceo = give(g, f, c => c.type === 'boost' && c.lv === 1);
  g.startCombat(f, [threat(1)]);
  g.handle(f.id, { type: 'play', card: ceo.uid });
  assert.strictEqual(g.cLevels(), 2);
  assert.strictEqual(g.cThreatPower(), 5);
  g.handle(f.id, { type: 'fight' });
  for (const p of g.players) g.handle(p.id, { type: 'pass' });
  assert.strictEqual(f.level, 8);
}

// 14. Penalità nuove
{
  const g = setup(), [a, b, c] = g.players;
  // Esposizione come penalità: vale anche per l'Ingegnere sociale e può far scattare l'audit
  a.role = take(g, x => x.type === 'role' && x.role === 'social'); a.level = 5; a.esp = 3;
  g.applyBad(a, [{ k: 'esp', n: 2 }]);
  assert(a.level === 4 && a.esp === 1, 'audit scattato, il punto in più resta');
  // credito
  a.credit = 700; g.applyBad(a, [{ k: 'credit' }]); assert.strictEqual(a.credit, 0);
  // furto: un avversario prende la carta, non va negli scarti
  const n = a.hand.length, others = b.hand.length + c.hand.length, disc = g.disc.T.length + g.disc.A.length;
  g.applyBad(a, [{ k: 'robbed', n: 1 }]);
  assert(a.hand.length === n - 1 && b.hand.length + c.hand.length === others + 1 && g.disc.T.length + g.disc.A.length === disc);
  // asset che cambia proprietario
  const gear = take(g, x => x.type === 'gear' && x.slot === 'cr'); a.gear.cr = gear;
  g.applyBad(a, [{ k: 'give', s: 'cr' }]);
  assert(!a.gear.cr && (b.hand.includes(gear) || c.hand.includes(gear)));
  // tutti scartano
  const sizes = g.players.map(p => p.hand.length);
  g.applyBad(a, [{ k: 'all', n: 1 }]);
  g.players.forEach((p, i) => assert.strictEqual(p.hand.length, Math.max(0, sizes[i] - 1)));
  // l'asset migliore torna in mano
  const g1 = take(g, x => x.type === 'gear' && x.slot === 'hw' && x.bonus === 3), g2 = take(g, x => x.type === 'gear' && x.slot === 'gd' && x.bonus === 1);
  a.gear.hw = g1; a.gear.gd = g2;
  g.applyBad(a, [{ k: 'unequip' }]);
  assert(!a.gear.hw && a.gear.gd === g2 && a.hand.includes(g1));
}

// 15. Sfighe che coinvolgono chi le gioca: furto, scambio di ruolo, scambio di mano
{
  const g = setup(), [a, b] = g.players;
  const steal = give(g, a, x => x.type === 'curse' && x.bad[0].k === 'steal');
  const nb = b.hand.length, na = a.hand.length;
  g.handle(a.id, { type: 'curse', card: steal.uid, target: b.id });
  assert(b.hand.length === nb - 1 && a.hand.length === na, 'una carta giocata, una rubata');
  const role = take(g, x => x.type === 'role' && x.role === 'red'); b.role = role;
  const swap = give(g, a, x => x.type === 'curse' && x.bad[0].k === 'swapRole');
  g.handle(a.id, { type: 'curse', card: swap.uid, target: b.id });
  assert(a.role === role && !b.role, 'il ruolo cambia scrivania');
  const ho = give(g, a, x => x.type === 'curse' && x.bad[0].k === 'handover');
  const ha = a.hand.filter(x => x !== ho), hb = [...b.hand];
  g.handle(a.id, { type: 'curse', card: ho.uid, target: b.id });
  assert.deepStrictEqual(a.hand, hb); assert.deepStrictEqual(b.hand, ha);
}

// 16. Il malware era nel backup: la minaccia si duplica con le sue interferenze; livelli e tesori raddoppiano; la copia non va negli scarti
{
  const g = setup(), [f, s] = g.players;
  f.level = 7;
  const mate = give(g, s, trick('mate'));
  const c = fight(g, f, threat(1));
  c.threats[0].mod = 2;
  g.handle(s.id, { type: 'trick', card: mate.uid });
  assert.strictEqual(c.threats.length, 2);
  assert(c.threats[1].copy && c.threats[1].mod === 2, 'la copia porta con sé le interferenze');
  assert.strictEqual(g.cThreatPower(), 6);
  assert.strictEqual(g.cLevels(), 2);
  assert.strictEqual(g.cTreasures(), 4);
  assert(s.esp === 1 && c.lastSab, 'contro un altro è un sabotaggio');
  const disc = g.disc.T.length;
  for (const p of g.players) g.handle(p.id, { type: 'pass' });
  assert(!g.combat && f.level === 9, 'vince e prende due livelli');
  assert.strictEqual(g.disc.T.length - disc, 1, 'negli scarti va una carta sola');
}

// 17. Pair programming: la forza base conta doppio, una volta sola; Spegni e riaccendi lo azzera
{
  const g = setup(), [f, s] = g.players;
  f.level = 4;
  const d1 = give(g, f, trick('double')), d2 = give(g, s, trick('double')), rb = give(g, s, trick('reboot'));
  const c = fight(g, f, threat(6));
  assert(!g.cWinning());
  g.handle(f.id, { type: 'trick', card: d1.uid });
  assert(c.double && g.cFighterPower() === 8 && g.cWinning());
  refuses(() => g.handle(s.id, { type: 'trick', card: d2.uid }), 'una volta per combattimento');
  g.handle(s.id, { type: 'trick', card: rb.uid });
  assert(!c.double && !g.cWinning(), 'il riavvio azzera anche il pair programming');
}

// 18. Escalation al management: pareggio esatto, anche a match point; non contro un Red Teamer; l'Honeypot lo annulla
{
  const g = setup(), [f, s] = g.players;
  f.level = 9;
  const so = give(g, s, trick('standoff')), hp = give(g, f, trick('honeypot'));
  const c = fight(g, f, threat(3));
  g.handle(s.id, { type: 'trick', card: so.uid });
  assert(g.cFighterPower() === g.cThreatPower() && !g.cWinning() && s.esp === 1);
  g.handle(f.id, { type: 'trick', card: hp.uid });
  assert(g.cWinning() && c.mBonus === 0, 'annullato dall\'Honeypot');

  const g2 = setup(), [f2, s2] = g2.players;
  f2.level = 5; f2.role = take(g2, x => x.type === 'role' && x.role === 'red');
  const so2 = give(g2, s2, trick('standoff'));
  fight(g2, f2, threat(2));
  refuses(() => g2.handle(s2.id, { type: 'trick', card: so2.uid }), 'il Red Teamer vince i pareggi');
}

// 19. Pausa pranzo: tesori sì, livelli no; un altro non la gioca su chi sta per prendere root
{
  const g = setup(), [f, s] = g.players;
  f.level = 3;
  const lu = give(g, f, trick('lunch'));
  fight(g, f, threat(12));
  const hand = f.hand.length;
  g.handle(f.id, { type: 'trick', card: lu.uid });
  assert(!g.combat && f.level === 3 && f.hand.length === hand - 1 + 2 && g.phase === 'end', 'due tesori, nessun livello');

  const g2 = setup(), [f2, s2] = g2.players;
  f2.level = 9;
  const lu2 = give(g2, s2, trick('lunch'));
  fight(g2, f2, threat(2));
  refuses(() => g2.handle(s2.id, { type: 'trick', card: lu2.uid }), 'non ferma un match point');
  assert(s);
}

// 20. Alert a cascata: la prima Minaccia del mazzo entra nello scontro, le carte scoperte prima vanno negli scarti
{
  const g = setup(), [f, s] = g.players;
  f.level = 6;
  const al = give(g, s, trick('cascade'));
  const curse = take(g, x => x.type === 'curse'), th = take(g, x => x.type === 'threat' && x.l === 5);
  g.decks.T.push(th, curse); // si pesca dalla fine: prima la Sfiga, poi la Minaccia
  const c = fight(g, f, threat(2));
  g.handle(s.id, { type: 'trick', card: al.uid });
  assert(c.threats.length === 2 && c.threats[1].card === th && g.disc.T.includes(curse) && s.esp === 1);
}

// 21. Riassegnazione dopo Pair programming: il raddoppio resta a chi l'ha giocato, non passa a chi eredita il ticket
{
  const g = setup(), [f, s] = g.players;
  f.level = 6; s.level = 1;
  const d = give(g, f, trick('double')), ra = give(g, f, trick('reassign'));
  g.startCombat(f, [threat(8)]);
  g.handle(f.id, { type: 'trick', card: d.uid });
  g.handle(f.id, { type: 'trick', card: ra.uid, target: s.id });
  const c = g.combat;
  assert(c.fighter === s.id && !c.double && g.cFighterPower() === g.basePower(s), 'niente raddoppio per chi eredita');
}

// 22. Escalation al management: solo contro chi è in vantaggio (altrimenti lo aiuterebbe, o si sprecherebbe)
{
  const g = setup(), [f, s] = g.players;
  f.level = 2;
  const so = give(g, s, trick('standoff'));
  fight(g, f, threat(9));
  refuses(() => g.handle(s.id, { type: 'trick', card: so.uid }), 'abbasserebbe la minaccia');
  assert(s.hand.includes(so) && g.combat.mBonus === 0);
  const g2 = setup(), [f2] = g2.players;
  f2.level = 2;
  const so2 = give(g2, f2, trick('standoff'));
  fight(g2, f2, threat(9));
  refuses(() => g2.handle(f2.id, { type: 'trick', card: so2.uid }), 'chi perde non ci guadagna niente');
}

// 23. Honeypot su Movimento laterale: se la minaccia entrata è stata duplicata, se ne va anche la copia
{
  const g = setup(), [f, s] = g.players;
  f.level = 8;
  const lat = give(g, s, c => c.type === 'lateral'), th = give(g, s, c => c.type === 'threat');
  const mt = give(g, f, trick('mate')), hp = give(g, f, trick('honeypot'));
  const c = fight(g, f, threat(1));
  g.handle(s.id, { type: 'play', card: lat.uid, threat: th.uid });
  g.handle(f.id, { type: 'trick', card: mt.uid }); // chi combatte duplica: non è un sabotaggio, l'ultimo resta il laterale
  assert.strictEqual(c.threats.length, 3);
  g.handle(f.id, { type: 'trick', card: hp.uid });
  assert(c.threats.length === 1 && g.disc.T.includes(th), 'via la minaccia laterale e la sua copia');
}

// 24. Aiuto: l'aiutante pesca la parte concordata, chi combatte il resto
{
  const g = setup(), [f, h] = g.players;
  f.level = 3; h.level = 3;
  const c = fight(g, f, threat(5, { tr: 3 }));
  g.handle(f.id, { type: 'askHelp', to: h.id, share: 2 });
  g.handle(h.id, { type: 'answerHelp', accept: true });
  const fh = f.hand.length, hh = h.hand.length;
  for (const p of g.players) g.handle(p.id, { type: 'pass' });
  assert(!g.combat && h.hand.length - hh === 2 && f.hand.length - fh === 1 && f.level === 4 && h.level === 3);
  assert(c.share === 2);
}

console.log('OK tricks');
