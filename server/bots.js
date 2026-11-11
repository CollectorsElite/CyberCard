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
  return c.threats.some(t => t.card.bad.some(e => (e.k === 'lvl' && (e.n >= 2 || f.level >= 7)) || ['gearAll', 'wipe', 'best'].includes(e.k)));
}

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
    .concat(f.hand.filter(x => x.type === 'boost' && x.amt < 0).map(x => ({ card: x, val: -x.amt, a: { type: 'play', card: x.uid } })));
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
  }).filter(Boolean).sort((a, b) => a.share - b.share);
  return cands[0] || null;
}

function interfere(g, b, c) {
  const f = g.fighter(c);
  if (!g.cWinning(c) || f === b || c.helper === b.id) return null;
  const must = f.level + g.cLevels(c) >= 10;
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
  const need = g.cFighterPower(c) - g.cThreatPower(c) + (g.isRole(f, 'red') ? 1 : 0);
  const total = opts.reduce((s, o) => s + o.val, 0);
  if (!opts.length || (total < need && !must)) return null;
  return pickCards(opts, need)[0].a;
}

function curseChoice(g, b) {
  const cs = b.hand.filter(c => c.type === 'curse'); if (!cs.length) return null;
  const t = g.players.filter(p => p !== b).sort((x, y) => y.level - x.level || g.basePower(y) - g.basePower(x))[0];
  if (t.level < 4 || t.level < b.level) return null;
  if (b.esp >= 3 && !g.isRole(b, 'social') && t.level < 8) return null;
  const card = cs.find(c => g.curseMatters(t, c));
  return card ? { type: 'curse', card: card.uid, target: t.id } : null;
}

function decide(g, pid) {
  if (g.over) return null;
  const b = g.p(pid), c = g.combat;
  if (c) {
    if (c.offer && c.offer.to === pid) return answerOffer(g, b, c);
    if (c.offer && c.offer.from === pid) return null; // aspetta la risposta
    if (c.step === 'prep' && c.fighter === pid) return selfBoost(g, b, c) || { type: 'fight' };
    if (c.step === 'window' && !c.passes.has(pid)) {
      if (c.fighter === pid) {
        if (c.offer) return null; // aspetta la risposta
        if (!g.cWinning(c)) {
          const s = selfBoost(g, b, c); if (s) return s;
          if (!c.helper) { const h = pickHelper(g, b, c); if (h) return { type: 'askHelp', to: h.p.id, share: h.share }; }
        }
        return { type: 'pass' };
      }
      return interfere(g, b, c) || { type: 'pass' };
    }
    if (c.step === 'flee' && c.fighter === pid) {
      const rb = b.hand.find(x => x.escape);
      return rb && severe(g, c) ? { type: 'rollback', card: rb.uid } : { type: 'flee' };
    }
    return null;
  }
  // Fuori turno (e senza combattimento): stessi gestisci/curse degli umani.
  if (g.current.id !== pid) return manage(g, b) || curseChoice(g, b) || null;
  const m = manage(g, b); if (m) return m;
  if (g.phase === 'open') return { type: 'openTicket' };
  if (g.phase === 'after') {
    const myP = g.basePower(b) - b.penalty;
    const margin = th => myP - (th.l + g.vsBonus(th, b)) - (b.level + th.lv >= 10 ? 6 : 3);
    const t = b.hand.filter(x => x.type === 'threat' && margin(x) >= 0).sort((x, y) => y.l - x.l)[0];
    if (t) return { type: 'trouble', card: t.uid };
    return { type: 'loot' };
  }
  const cu = curseChoice(g, b); if (cu) return cu;
  return { type: 'endTurn', discard: g.autoDiscard(b) };
}

module.exports = { decide };
