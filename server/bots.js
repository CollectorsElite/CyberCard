'use strict';
// Logica dei bot: dato lo stato, restituisce UNA azione alla volta (o null).
// Il server la applica con un piccolo ritardo, così gli umani vedono cosa succede.

function pickCards(opts, need) {
  const pool = [...opts].sort((a, b) => a.val - b.val), out = [];
  while (need > 0 && pool.length) {
    const i = pool.findIndex(o => o.val >= need);
    const o = i >= 0 ? pool.splice(i, 1)[0] : pool.pop();
    out.push(o); need -= o.val;
  }
  return out;
}

function severe(g, c) {
  const f = g.fighter(c);
  return c.threats.some(t => t.card.bad.some(e => (e.k === 'lvl' && (e.n >= 2 || f.level >= 7)) || ['gearAll', 'wipe', 'best'].includes(e.k) || (e.k === 'give' && e.s === 'best')));
}
const trick = (p, fx) => p.hand.find(x => x.type === 'trick' && x.fx === fx);
const wins = (g, f, fp, tp) => fp > tp || (fp === tp && g.isRole(f, 'red'));
const matchPoint = (g, c) => g.fighter(c).level + g.cLevels(c) >= 10;

// Quanti tesori vuole il bot per aiutare; null se non aiuterebbe a nessun prezzo.
function helpDemand(g, b, c) {
  const f = g.fighter(c), tr = g.cTreasures(c);
  if (f.level + g.cLevels(c) >= 10) return null;
  if (f.level >= b.level + 3) return null;
  if (tr === 0) return null;
  const fp = g.cFighterPower(c) + g.basePower(b), tp = g.cThreatPower(c);
  if (!(fp > tp || (fp === tp && g.isRole(f, 'red')))) return null;
  return Math.min(tr, Math.ceil(tr / 2) + (f.level > b.level ? 1 : 0));
}

// Risposta del bot a una proposta: accetta se gli conviene, altrimenti rilancia con la sua cifra finché si può.
function answerOffer(g, b, c) {
  const o = c.offer, tr = g.cTreasures(c), canCounter = o.round < g.helpCounters;
  if (c.fighter === b.id) {
    // il bot combatte e l'altro ha rilanciato: cede di più se la sconfitta costa cara
    const limit = severe(g, c) ? tr : Math.min(tr, Math.ceil(tr / 2) + 1);
    if (o.share <= limit) return { type: 'answerHelp', accept: true };
    return canCounter ? { type: 'counterHelp', share: limit } : { type: 'answerHelp', accept: false };
  }
  const demand = helpDemand(g, b, c);
  if (demand === null) return { type: 'answerHelp', accept: false };
  if (o.share >= demand) return { type: 'answerHelp', accept: true };
  return canCounter ? { type: 'counterHelp', share: demand } : { type: 'answerHelp', accept: false };
}

// Prossima azione di gestione nel proprio turno (ruolo, equipaggiamento, livelli, vendite).
function manage(g, b) {
  if (!b.role) {
    const pref = ['red', 'sys', 'blue', 'social'];
    const r = b.hand.filter(c => c.type === 'role').sort((x, y) => pref.indexOf(x.role) - pref.indexOf(y.role))[0];
    if (r) return { type: 'takeRole', card: r.uid };
  }
  for (const gr of b.hand.filter(c => c.type === 'gear')) {
    const eq = b.gear[gr.slot];
    if (!eq || g.gBonus(b, gr) > g.gBonus(b, eq)) return { type: 'equip', card: gr.uid };
  }
  if (b.level < 9) { const l = b.hand.find(c => c.type === 'levelup'); if (l) return { type: 'levelUp', card: l.uid }; }
  const junk = b.hand.find(c => c.type === 'gear');
  if (junk) return { type: 'sell', card: junk.uid };
  return null;
}

function selfBoost(g, f, c) {
  if (g.cWinning(c)) return null;
  const opts = f.hand.filter(x => x.type === 'oneshot' && !x.escape).map(x => ({ card: x, val: x.bonus, a: { type: 'play', card: x.uid, side: 'f' } }))
    .concat(f.hand.filter(x => x.type === 'boost' && x.amt < 0).map(x => ({ card: x, val: -x.amt, a: { type: 'play', card: x.uid } })))
    .concat(f.hand.filter(x => x.type === 'trick' && x.fx === 'ai').map(x => ({ card: x, val: 3, a: { type: 'trick', card: x.uid, side: 'f' } })))
    .concat(!c.double ? f.hand.filter(x => x.type === 'trick' && x.fx === 'double').slice(0, 1).map(x => ({ card: x, val: g.basePower(f), a: { type: 'trick', card: x.uid } })) : []);
  const need = g.cThreatPower(c) - g.cFighterPower(c) + (g.isRole(f, 'red') ? 0 : 1);
  if (opts.reduce((s, o) => s + o.val, 0) < need) return null;
  return pickCards(opts, need)[0].a;
}

function pickHelper(g, f, c) {
  const tr = g.cTreasures(c); if (!tr) return null;
  const tp = g.cThreatPower(c), base = g.cFighterPower(c);
  const cands = g.players.filter(p => p !== f && !c.asked.includes(p.id)).map(p => {
    const fp = base + g.basePower(p);
    if (!(fp > tp || (fp === tp && g.isRole(f, 'red')))) return null;
    const share = p.isBot ? Math.min(tr, Math.ceil(tr / 2) + (f.level > p.level ? 1 : 0)) : Math.max(1, Math.floor(tr / 2));
    return { p, share };
  }).filter(Boolean);
  // a parità di prezzo chiede a chi è più indietro; tra pari livello, a caso (non sempre al primo del tavolo)
  cands.forEach(x => { x.tie = g.rng(1000); });
  cands.sort((a, b) => a.share - b.share || a.p.level - b.p.level || a.tie - b.tie);
  return cands[0] || null;
}

// Carte speciali di chi combatte, quando è in svantaggio e i bonus non bastano.
function fighterTricks(g, f, c) {
  const tp = g.cThreatPower(c), fp = g.cFighterPower(c);
  const hp = trick(f, 'honeypot');
  if (hp && c.lastSab && c.lastSab.by !== f.id) return { type: 'trick', card: hp.uid };
  const oc = trick(f, 'oncall');
  if (oc && !c.helper && !c.offer) {
    const t = g.players.filter(p => p !== f && wins(g, f, fp + g.basePower(p), tp)).sort((x, y) => g.basePower(x) - g.basePower(y))[0];
    if (t) return { type: 'trick', card: oc.uid, target: t.id };
  }
  const rb = trick(f, 'reboot');
  if (rb) {
    const h = g.helper(c), clean = g.basePower(f) - f.penalty + (h ? g.basePower(h) : 0);
    if (wins(g, f, clean, c.threats.reduce((s, t) => s + t.card.l + g.vsBonus(t.card, f), 0))) return { type: 'trick', card: rb.uid };
  }
  return null;
}
// In svantaggio, senza aiuto: meglio i tesori senza livelli che rischiare la fuga.
function lunchOut(g, f, c) {
  const card = trick(f, 'lunch');
  return card && !g.cWinning(c) && (severe(g, c) || g.cTreasures(c) >= 2) ? { type: 'trick', card: card.uid } : null;
}
// Riassegnazione: scarica il ticket su chi probabilmente lo perde, meglio se è in testa.
function reassign(g, f, c) {
  const card = trick(f, 'reassign');
  if (!card || c.reassigned || c.helper || c.offer || g.cWinning(c)) return null;
  if (!severe(g, c) && g.rng(100) < 50) return null;
  const tp = t => c.threats.reduce((s, x) => s + x.card.l + x.mod + g.vsBonus(x.card, t), 0) + c.mBonus;
  const t = g.players.filter(p => p !== f && g.basePower(p) - p.penalty < tp(p)).sort((x, y) => y.level - x.level)[0];
  return t ? { type: 'trick', card: card.uid, target: t.id } : null;
}

function interfere(g, b, c) {
  const f = g.fighter(c);
  if (f === b || c.helper === b.id) return null;
  if (!g.cWinning(c)) {
    // il sabotaggio ha funzionato: con un Change freeze chi combatte non può più rimediare
    const fr = trick(b, 'freeze');
    return fr && c.lastSab && c.lastSab.by === b.id && !matchPoint(g, c) ? { type: 'trick', card: fr.uid } : null;
  }
  const must = matchPoint(g, c);
  if (c.mood[b.id] === undefined) {
    const top = Math.max(...g.players.map(p => p.level));
    c.mood[b.id] = (f.level === top && f.level > b.level) ? g.rng(100) < 35 : g.rng(100) < 6;
  }
  if (!must && !c.mood[b.id]) return null;
  if (!must && b.esp >= 3 && !g.isRole(b, 'social')) return null;
  const opts = b.hand.filter(x => x.type === 'boost' && x.amt > 0).map(x => ({ val: x.amt, a: { type: 'play', card: x.uid } }))
    .concat(b.hand.filter(x => x.type === 'oneshot' && !x.escape).map(x => ({ val: x.bonus, a: { type: 'play', card: x.uid, side: 'm' } })));
  const lat = b.hand.find(x => x.type === 'lateral');
  const ths = b.hand.filter(x => x.type === 'threat').sort((x, y) => y.l - x.l);
  if (lat && ths.length) opts.push({ val: ths[0].l + g.vsBonus(ths[0], f), a: { type: 'play', card: lat.uid, threat: ths[0].uid } });
  b.hand.filter(x => x.type === 'trick' && x.fx === 'ai').forEach(x => opts.push({ val: 3, a: { type: 'trick', card: x.uid, side: 'm' } }));
  const po = trick(b, 'poach'), h = g.helper(c);
  if (po && h) opts.push({ val: g.basePower(h), a: { type: 'trick', card: po.uid } });
  const last = c.threats[c.threats.length - 1], mt = trick(b, 'mate');
  if (mt) opts.push({ val: last.card.l + last.mod + g.vsBonus(last.card, f), a: { type: 'trick', card: mt.uid } });
  const cs = trick(b, 'cascade');
  if (cs) opts.push({ val: 4, a: { type: 'trick', card: cs.uid } }); // forza attesa prudente: il mazzo è pieno di minacce piccole
  const best = g.bestGear(f), hot = b.hand.find(x => x.type === 'curse' && x.bad[0].k === 'unequip');
  if (hot && best) opts.push({ val: g.gBonus(f, best), a: { type: 'curse', card: hot.uid, target: f.id } });
  const need = g.cFighterPower(c) - g.cThreatPower(c) + (g.isRole(f, 'red') ? 1 : 0);
  const total = opts.reduce((s, o) => s + o.val, 0);
  // Escalation al management: porta la minaccia al pareggio, quindi basta da sola (non contro un Red Teamer)
  const so = trick(b, 'standoff');
  if (so && !g.isRole(f, 'red') && c.step === 'window' && (must || total < need)) return { type: 'trick', card: so.uid };
  if (total < need || !opts.length) {
    // se le carte non bastano, contro chi è lanciato resta il Falso positivo (ma non a match point)
    const fp = trick(b, 'falsepos');
    if (!must && fp && f.level >= 7 && c.mood[b.id]) return { type: 'trick', card: fp.uid };
    if (!opts.length || !must) return null;
  }
  return pickCards(opts, need)[0].a;
}

function curseChoice(g, b) {
  const cs = b.hand.filter(c => c.type === 'curse'); if (!cs.length) return null;
  const t = g.players.filter(p => p !== b).sort((x, y) => y.level - x.level || g.basePower(y) - g.basePower(x))[0];
  if (t.level < 4 || t.level < b.level) return null;
  if (b.esp >= 3 && !g.isRole(b, 'social') && t.level < 8) return null;
  const k = g.combat;
  if (k && k.frozen && (t.id === k.fighter || t.id === k.helper)) return null;
  const pref = ['red', 'sys', 'blue', 'social'], rank = p => (p.role ? pref.indexOf(p.role.role) : 9);
  const useful = c => {
    switch (c.bad[0].k) {
      case 'unequip': return false; // serve solo in combattimento: la gioca interfere()
      case 'swapRole': return !!t.role && rank(t) < rank(b);
      case 'handover': return t.hand.length >= b.hand.length + 1;
      default: return g.curseMatters(t, c);
    }
  };
  const card = cs.find(useful);
  return card ? { type: 'curse', card: card.uid, target: t.id } : null;
}
// Risposta automatica: la attiva chi è in testa, fuori dal combattimento.
function autoReply(g, b) {
  const card = trick(b, 'ooo');
  if (!card || b.ooo || b.level < 4 || g.players.some(p => p.level > b.level)) return null;
  return { type: 'trick', card: card.uid };
}

function decide(g, pid) {
  if (g.over) return null;
  const b = g.p(pid), c = g.combat;
  if (c) {
    if (c.offer && c.offer.to === pid) return answerOffer(g, b, c);
    if (c.offer && c.offer.from === pid) return null; // aspetta la risposta
    if (c.step === 'prep' && c.fighter === pid) return selfBoost(g, b, c) || reassign(g, b, c) || { type: 'fight' };
    if (c.step === 'window' && !c.passes.has(pid)) {
      if (c.frozen) return { type: 'pass' };
      if (c.fighter === pid) {
        if (c.offer) return null; // aspetta la risposta
        if (!g.cWinning(c)) {
          const s = selfBoost(g, b, c) || fighterTricks(g, b, c); if (s) return s;
          if (!c.helper) { const h = pickHelper(g, b, c); if (h) return { type: 'askHelp', to: h.p.id, share: h.share }; }
          const lo = lunchOut(g, b, c); if (lo) return lo;
          const fp = trick(b, 'falsepos'); if (fp && severe(g, c)) return { type: 'trick', card: fp.uid };
        } else if (c.lastSab && !matchPoint(g, c)) {
          // già sabotato una volta e di nuovo in vantaggio: congela tutto
          const fr = trick(b, 'freeze'); if (fr) return { type: 'trick', card: fr.uid };
        }
        return { type: 'pass' };
      }
      return interfere(g, b, c) || { type: 'pass' };
    }
    if (c.step === 'flee' && c.fighter === pid) {
      const sg = trick(b, 'scapegoat');
      if (sg) { const t = g.players.filter(p => p !== b).sort((x, y) => y.level - x.level || g.basePower(y) - g.basePower(x))[0]; return { type: 'trick', card: sg.uid, target: t.id }; }
      const rb = b.hand.find(x => x.escape);
      return rb && severe(g, c) ? { type: 'rollback', card: rb.uid } : { type: 'flee' };
    }
    return null;
  }
  // Fuori turno (e senza combattimento): stessi gestisci/curse degli umani.
  if (g.current.id !== pid) return manage(g, b) || autoReply(g, b) || curseChoice(g, b) || null;
  const m = manage(g, b) || autoReply(g, b); if (m) return m;
  if (g.phase === 'open') return { type: 'openTicket' };
  if (g.phase === 'after') {
    const myP = g.basePower(b) - b.penalty;
    // basta essere in vantaggio di 1, come farebbe una persona; a match point serve margine, perché tutti sabotano
    const margin = th => myP - (th.l + g.vsBonus(th, b)) - (b.level + th.lv >= 10 ? 6 : 1);
    const t = b.hand.filter(x => x.type === 'threat' && margin(x) >= 0).sort((x, y) => y.l - x.l)[0];
    if (t) return { type: 'trouble', card: t.uid };
    return { type: 'loot' };
  }
  const cu = curseChoice(g, b); if (cu) return cu;
  return { type: 'endTurn', discard: g.autoDiscard(b) };
}

module.exports = { decide };
