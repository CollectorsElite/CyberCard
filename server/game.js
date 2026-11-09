'use strict';
// Motore di gioco autoritativo. Il client non decide nulla: invia intenzioni,
// il server le valida contro lo stato e manda a ciascuno solo ciò che può vedere.

const crypto = require('crypto');
const { TITLES, SLOTS, ROLES, QUIPS, buildDecks } = require('./cards');

const HAND_MAX = 5, ESP_MAX = 4, WIN_LEVEL = 10;
const DEFAULT_TIMEOUTS = { turn: 90000, prep: 60000, window: 45000, offer: 25000, flee: 30000 };

class GameError extends Error {}
const fail = m => { throw new GameError(m); };
const pl = (n, s, p) => (n === 1 ? s : p);
const isInt = v => Number.isInteger(v);

class Game {
  constructor(players, opts = {}) {
    if (players.length < 2 || players.length > 6) fail('Servono da 2 a 6 giocatori.');
    this.rng = opts.rng || (n => crypto.randomInt(n));
    this.now = opts.now || (() => Date.now());
    this.to = { ...DEFAULT_TIMEOUTS, ...(opts.timeouts || {}) };
    this.uid = 0;
    const d = buildDecks(() => ++this.uid, a => this.shuffle(a));
    this.decks = { T: d.T, A: d.A };
    this.disc = { T: [], A: [] };
    this.players = players.map((p, i) => ({
      id: p.id, name: p.name, isBot: !!p.isBot, seat: i, level: 1, esp: 0, credit: 0, penalty: 0,
      role: null, gear: { hw: null, sw: null, cr: null, gd: null }, hand: [], blueUsed: false
    }));
    this.id = crypto.randomBytes(4).toString('hex');
    this.logs = []; this.fxs = []; this.seq = 0; this.version = 0;
    this.turn = 1; this.combat = null; this.revealed = null; this.over = false; this.winner = null;
    for (const p of this.players) for (let i = 0; i < 4; i++) { p.hand.push(this.draw('T')); p.hand.push(this.draw('A')); }
    this.cur = this.rng(this.players.length);
    this.startSeat = this.cur;
    this.log('Nuova partita. Il primo che arriva a livello 10 (root) vince.', 'sys');
    this.startTurn();
  }

  /* ---------- utilità ---------- */
  shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = this.rng(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  p(id) { const p = this.players.find(x => x.id === id); if (!p) fail('Giocatore sconosciuto.'); return p; }
  get current() { return this.players[this.cur]; }
  log(t, cls = '') { this.logs.push({ t, cls, i: ++this.seq }); if (this.logs.length > 400) this.logs.shift(); }
  fx(e) { this.fxs.push({ ...e, i: ++this.seq }); if (this.fxs.length > 300) this.fxs.shift(); }
  setDeadline(ms) { this.deadline = this.now() + ms; }
  draw(k) {
    const deck = this.decks[k], disc = this.disc[k];
    if (!deck.length && disc.length) { deck.push(...this.shuffle(disc.splice(0))); this.log(`Mazzo ${k === 'T' ? 'Ticket' : 'Asset'} rimescolato.`, 'sys'); }
    return deck.pop() || null;
  }
  discard(c) { if (c) this.disc[c.deck].push(c); }
  quip(kind) { const a = QUIPS[kind]; return a[this.rng(a.length)]; }
  say(kind) { const q = this.quip(kind); this.log(q, 'quip'); return q; }
  removeFromHand(p, c) { const i = p.hand.indexOf(c); if (i < 0) return false; p.hand.splice(i, 1); return true; }
  handCard(p, uid, type) {
    if (!isInt(uid)) fail('Carta non valida.');
    const c = p.hand.find(x => x.uid === uid);
    if (!c) fail('Quella carta non è nella tua mano.');
    if (type && (Array.isArray(type) ? !type.includes(c.type) : c.type !== type)) fail('Carta del tipo sbagliato per questa azione.');
    return c;
  }

  /* ---------- potenza ---------- */
  gearOf(p) { return Object.values(p.gear).filter(Boolean); }
  isRole(p, r) { return !!(p.role && p.role.role === r); }
  gBonus(p, g) { return g.bonus + (g.roleBonus && this.isRole(p, g.roleBonus.role) ? g.roleBonus.n : 0); }
  gearBonus(p) { return this.gearOf(p).reduce((s, g) => s + this.gBonus(p, g), 0); }
  basePower(p) { return p.level + this.gearBonus(p); }
  vsBonus(card, p) { return card.vs && this.isRole(p, card.vs.role) ? card.vs.n : 0; }
  fighter(c = this.combat) { return this.p(c.fighter); }
  helper(c = this.combat) { return c.helper ? this.p(c.helper) : null; }
  cFighterPower(c = this.combat) { const f = this.fighter(c), h = this.helper(c); return this.basePower(f) + c.fBonus - f.penalty + (h ? this.basePower(h) : 0); }
  cThreatPower(c = this.combat) { const f = this.fighter(c); return c.threats.reduce((s, t) => s + t.card.l + t.mod + this.vsBonus(t.card, f), 0) + c.mBonus; }
  cWinning(c = this.combat) { const a = this.cFighterPower(c), b = this.cThreatPower(c); return a > b || (a === b && this.isRole(this.fighter(c), 'red')); }
  cTreasures(c = this.combat) { return Math.max(0, c.threats.reduce((s, t) => s + t.card.tr + t.trMod, 0)); }
  cLevels(c = this.combat) { return c.threats.reduce((s, t) => s + t.card.lv, 0); }
  threatNames(c = this.combat) { return c.threats.map(t => t.card.name).join(' + '); }

  /* ---------- chi deve agire ---------- */
  needs() {
    if (this.over) return [];
    const c = this.combat;
    if (!c) return [this.current.id];
    const out = [];
    if (c.step === 'prep') out.push(c.fighter);
    else if (c.step === 'window') { for (const p of this.players) if (!c.passes.has(p.id)) out.push(p.id); }
    else if (c.step === 'flee') out.push(c.fighter);
    if (c.offer && !out.includes(c.offer.to)) out.push(c.offer.to);
    return out;
  }
  nextDeadline() {
    if (this.over) return null;
    const c = this.combat;
    return c && c.offer ? Math.min(this.deadline, c.offerDeadline) : this.deadline;
  }

  /* ---------- ingresso azioni ---------- */
  handle(pid, a) {
    if (this.over) fail('La partita è finita.');
    if (!a || typeof a.type !== 'string') fail('Azione non valida.');
    const fn = this['a_' + a.type];
    if (typeof fn !== 'function') fail('Azione sconosciuta.');
    fn.call(this, this.p(pid), a);
    this.version++;
  }
  ownFree(p) {
    if (this.current !== p) fail('Non è il tuo turno.');
    if (this.combat) fail('Non si può durante un combattimento.');
  }
  // Equipaggiamento, ruoli, livelli e vendite: in qualsiasi momento, ma mai durante un combattimento.
  noCombat() { if (this.combat) fail('Non si può durante un combattimento.'); }

  /* ---------- turno ---------- */
  startTurn() {
    this.phase = 'open'; this.revealed = null;
    const p = this.current; p.blueUsed = false;
    this.log(`Turno di ${p.name}.`, 'turn');
    this.setDeadline(this.to.turn);
  }
  a_openTicket(p) {
    this.ownFree(p);
    if (this.phase !== 'open') fail('Hai già aperto il ticket di questo turno.');
    const card = this.draw('T');
    if (!card) { this.phase = 'after'; this.setDeadline(this.to.turn); this.log('Mazzo Ticket esaurito.', 'sys'); return; }
    this.log(`${p.name} apre un ticket: ${card.name}.`);
    if (card.d && (card.type === 'threat' || card.type === 'curse')) this.log(`«${card.d}»`, 'quip');
    this.revealed = { card, by: p.id };
    if (card.type === 'threat') return this.startCombat(p, [card]);
    if (card.type === 'curse') this.applyCurse(p, card, null);
    else p.hand.push(card);
    this.phase = 'after'; this.setDeadline(this.to.turn);
  }
  a_trouble(p, a) {
    this.ownFree(p);
    if (this.phase !== 'after') fail('Puoi cercare guai solo se non hai combattuto in questo turno.');
    const card = this.handCard(p, a.card, 'threat');
    this.removeFromHand(p, card);
    this.log(`${p.name} cerca guai: tira fuori ${card.name}. Li ha trovati.`);
    if (card.d) this.log(`«${card.d}»`, 'quip');
    this.startCombat(p, [card]);
  }
  a_loot(p) {
    this.ownFree(p);
    if (this.phase !== 'after') fail('Puoi analizzare i log solo se non hai combattuto in questo turno.');
    const c = this.draw('T'); if (c) p.hand.push(c);
    this.log(`${p.name} analizza i log e pesca una carta coperta.`);
    this.say('loot');
    this.phase = 'end'; this.setDeadline(this.to.turn);
  }
  a_endTurn(p, a) {
    this.ownFree(p);
    if (this.phase === 'open') fail('Prima devi aprire un ticket.');
    const excess = p.hand.length - HAND_MAX;
    if (excess > 0) {
      const ids = Array.isArray(a.discard) ? a.discard : [];
      if (ids.length !== excess || new Set(ids).size !== ids.length) fail(`Devi scartare esattamente ${excess} ${pl(excess, 'carta', 'carte')}.`);
      const cards = ids.map(id => this.handCard(p, id));
      cards.forEach(c => { this.removeFromHand(p, c); this.discard(c); });
      this.log(`${p.name} scarta ${excess} ${pl(excess, 'carta', 'carte')} per il limite di mano.`, 'sys');
    }
    this.cur = (this.cur + 1) % this.players.length;
    if (this.cur === this.startSeat) this.turn++;
    this.startTurn();
  }

  /* ---------- gestione nel proprio turno ---------- */
  a_equip(p, a) {
    this.noCombat();
    const g = this.handCard(p, a.card, 'gear');
    this.removeFromHand(p, g);
    const old = p.gear[g.slot]; if (old) p.hand.push(old);
    p.gear[g.slot] = g;
    this.log(`${p.name} equipaggia ${g.name}.`);
  }
  a_unequip(p, a) {
    this.noCombat();
    if (!Object.prototype.hasOwnProperty.call(SLOTS, a.slot) || !p.gear[a.slot]) fail('Slot vuoto.');
    p.hand.push(p.gear[a.slot]); p.gear[a.slot] = null;
  }
  a_takeRole(p, a) {
    this.noCombat();
    const r = this.handCard(p, a.card, 'role');
    this.removeFromHand(p, r);
    if (p.role) this.discard(p.role);
    p.role = r;
    this.log(`${p.name} diventa ${r.name}.`);
  }
  a_dropRole(p) {
    this.noCombat();
    if (!p.role) fail('Non hai un ruolo.');
    this.discard(p.role); p.role = null;
  }
  a_levelUp(p, a) {
    this.noCombat();
    const c = this.handCard(p, a.card, 'levelup');
    if (p.level >= WIN_LEVEL - 1) fail('L\'ultimo livello si prende solo in combattimento.');
    this.removeFromHand(p, c); this.discard(c); p.level++;
    this.log(`${p.name} usa «${c.name}»: +1 livello.`, 'good');
  }
  a_sell(p, a) {
    this.noCombat();
    const c = p.hand.find(x => x.uid === a.card) || this.gearOf(p).find(x => x.uid === a.card);
    if (!c) fail('Carta non trovata.');
    if (!c.value) fail('Questa carta non si vende.');
    if (!this.removeFromHand(p, c)) p.gear[c.slot] = null;
    this.discard(c); p.credit += c.value;
    this.log(`${p.name} vende ${c.name} (${c.value} di credito).`);
    while (p.credit >= 1000 && p.level < WIN_LEVEL - 1) { p.credit -= 1000; p.level++; this.log(`${p.name} converte 1000 di credito in +1 livello.`, 'good'); }
  }
  a_discard(p, a) {
    this.noCombat();
    const c = this.handCard(p, a.card);
    this.removeFromHand(p, c); this.discard(c);
    this.log(`${p.name} scarta una carta.`, 'sys');
  }

  /* ---------- sfighe: giocabili da chiunque, in qualsiasi momento ---------- */
  a_curse(p, a) {
    const card = this.handCard(p, a.card, 'curse');
    const t = this.p(a.target);
    if (t === p) fail('Non puoi giocare una Sfiga su te stesso.');
    this.removeFromHand(p, card);
    this.applyCurse(t, card, p);
  }

  /* ---------- combattimento ---------- */
  startCombat(f, cards) {
    this.combat = {
      fighter: f.id, threats: cards.map(card => ({ card, mod: 0, trMod: 0 })), fBonus: 0, mBonus: 0,
      helper: null, share: 0, ev: [], step: 'prep', passes: new Set(), offer: null, offerDeadline: 0, asked: [], mood: {}
    };
    this.phase = 'combat'; this.revealed = null;
    this.log(`${f.name} affronta ${this.threatNames()} (forza ${this.cThreatPower()}).`, 'fight');
    this.setDeadline(this.to.prep);
  }
  inCombat(steps) { const c = this.combat; if (!c || !steps.includes(c.step)) fail('Azione non disponibile in questa fase del combattimento.'); return c; }
  touch(c) { c.passes.clear(); if (c.step === 'window') this.setDeadline(this.to.window); }
  a_fight(p) {
    const c = this.inCombat(['prep']);
    if (c.fighter !== p.id) fail('Non sei tu a combattere.');
    c.step = 'window'; this.touch(c);
    this.log(`Finestra di interferenza aperta: tutti devono dichiarare «passo».`, 'sys');
  }
  a_play(p, a) {
    const c = this.inCombat(['prep', 'window']);
    if (c.step === 'prep' && p.id !== c.fighter && p.id !== c.helper) fail('Gli altri possono interferire solo quando la finestra è aperta.');
    const card = this.handCard(p, a.card, ['oneshot', 'boost', 'lateral']);
    const f = this.fighter(c), sabot = p !== f && p.id !== c.helper;
    let txt;
    if (card.type === 'oneshot') {
      if (card.escape) fail('Il Rollback si usa al momento della fuga.');
      if (a.side !== 'f' && a.side !== 'm') fail('Scegli a chi dare il bonus.');
      if (a.side === 'f') c.fBonus += card.bonus; else c.mBonus += card.bonus;
      txt = `${p.name}: ${card.name} (+${card.bonus} ${a.side === 'f' ? 'a ' + f.name : 'alla minaccia'})`;
      this.removeFromHand(p, card); this.discard(card);
      if (a.side === 'm' && sabot) this.sabotage(p, txt); else this.cEv(c, txt);
    } else if (card.type === 'boost') {
      const t = c.threats[c.threats.length - 1];
      t.mod += card.amt; t.trMod += card.tr;
      txt = `${p.name}: ${card.name} (${card.amt > 0 ? '+' : ''}${card.amt} alla minaccia)`;
      this.removeFromHand(p, card); this.discard(card);
      if (card.amt > 0 && sabot) this.sabotage(p, txt); else this.cEv(c, txt);
    } else {
      const th = this.handCard(p, a.threat, 'threat');
      this.removeFromHand(p, card); this.removeFromHand(p, th); this.discard(card);
      c.threats.push({ card: th, mod: 0, trMod: 0 });
      txt = `${p.name}: Movimento laterale, entra ${th.name} (forza ${th.l}). «${th.d}»`;
      if (sabot) this.sabotage(p, txt); else this.cEv(c, txt);
    }
    this.touch(c);
  }
  cEv(c, txt, cls = '') { c.ev.push(txt); this.log(txt, cls); }
  sabotage(p, txt) {
    this.cEv(this.combat, txt, 'sab');
    const q = this.say('sabotage');
    this.fx({ kind: 'sabotage', by: p.id, target: this.combat.fighter, text: txt, quip: q });
    this.addEsp(p);
  }
  a_pass(p) {
    const c = this.inCombat(['window']);
    if (c.passes.has(p.id)) fail('Hai già passato.');
    c.passes.add(p.id);
    this.maybeClose();
  }
  a_askHelp(p, a) {
    const c = this.inCombat(['prep', 'window']);
    if (c.fighter !== p.id) fail('Solo chi combatte può chiedere aiuto.');
    if (c.helper) fail('Hai già un aiutante.');
    if (c.offer) fail('C\'è già una richiesta in sospeso.');
    const to = this.p(a.to);
    if (to === p) fail('Non puoi aiutarti da solo.');
    const tr = this.cTreasures(c);
    if (!isInt(a.share) || a.share < 0 || a.share > tr) fail(`L'offerta deve essere tra 0 e ${tr} tesori.`);
    c.offer = { from: p.id, to: to.id, share: a.share };
    c.offerDeadline = this.now() + this.to.offer;
    if (!c.asked.includes(to.id)) c.asked.push(to.id);
    this.log(`${p.name} chiede aiuto a ${to.name} offrendo ${a.share} ${pl(a.share, 'tesoro', 'tesori')}.`);
  }
  a_cancelHelp(p) {
    const c = this.inCombat(['prep', 'window']);
    if (!c.offer || c.offer.from !== p.id) fail('Nessuna richiesta da annullare.');
    c.offer = null;
    this.maybeClose();
  }
  a_answerHelp(p, a) {
    const c = this.combat;
    if (!c || !c.offer || c.offer.to !== p.id) fail('Nessuna richiesta di aiuto per te.');
    const o = c.offer; c.offer = null;
    if (a.accept) {
      c.helper = p.id; c.share = o.share;
      this.cEv(c, `${p.name} si unisce al combattimento (+${this.basePower(p)}) per ${o.share} ${pl(o.share, 'tesoro', 'tesori')}`, 'good');
      this.say('helpYes');
      this.touch(c);
    } else {
      this.log(`${p.name} rifiuta di aiutare ${this.fighter(c).name}.`);
      this.fx({ kind: 'helpNo', by: p.id, to: o.from, quip: this.say('helpNo') });
      this.maybeClose();
    }
  }
  maybeClose() {
    const c = this.combat;
    if (!c || c.step !== 'window' || c.offer) return;
    if (!this.players.every(p => c.passes.has(p.id))) return;
    if (this.cWinning(c)) { this.resolveWin(c); this.endCombat(); }
    else { c.step = 'flee'; this.setDeadline(this.to.flee); this.log(`${this.fighter(c).name} è in svantaggio: deve tentare la fuga.`, 'bad'); }
  }
  a_flee(p) {
    const c = this.inCombat(['flee']);
    if (c.fighter !== p.id) fail('Non sei tu a combattere.');
    for (const t of c.threats) {
      const need = Math.min(6, Math.max(2, (this.isRole(p, 'sys') ? 4 : 5) - t.card.flee));
      const roll = 1 + this.rng(6), ok = roll >= need;
      this.log(`${p.name} tenta la fuga da ${t.card.name}: ${roll} (serve ${need}+), ${ok ? 'scappa' : 'preso'}.`, ok ? '' : 'bad');
      const q = this.say(ok ? 'fleeOk' : 'fleeKo');
      this.fx({ kind: 'roll', pid: p.id, threat: t.card.name, roll, need, ok, bad: ok ? '' : this.badText(t.card.bad), quip: q });
      if (!ok) this.applyBad(p, t.card.bad);
    }
    this.endCombat();
  }
  a_rollback(p, a) {
    const c = this.inCombat(['flee']);
    if (c.fighter !== p.id) fail('Non sei tu a combattere.');
    const card = this.handCard(p, a.card, 'oneshot');
    if (!card.escape) fail('Serve una carta Rollback.');
    this.removeFromHand(p, card); this.discard(card);
    this.log(`${p.name} usa Rollback e si sgancia dal combattimento.`);
    this.say('rollback');
    this.endCombat();
  }
  resolveWin(c) {
    const f = this.fighter(c), h = this.helper(c), tr = this.cTreasures(c), lv = this.cLevels(c);
    const share = h ? Math.min(tr, c.share) : 0;
    const gotH = [], gotF = [];
    for (let i = 0; i < share; i++) { const x = this.draw('A'); if (x) { h.hand.push(x); gotH.push(x.name); } }
    for (let i = share; i < tr; i++) { const x = this.draw('A'); if (x) { f.hand.push(x); gotF.push(x.name); } }
    f.level = Math.min(WIN_LEVEL, f.level + lv);
    this.log(`${f.name} neutralizza ${this.threatNames(c)}: +${lv} ${pl(lv, 'livello', 'livelli')}, ${tr} ${pl(tr, 'tesoro', 'tesori')}.`, 'good');
    if (h) this.log(`${h.name} incassa ${share} ${pl(share, 'tesoro', 'tesori')} per l'aiuto.`);
    const q = f.level >= WIN_LEVEL ? '' : this.say('win');
    this.fx({ kind: 'win', pid: f.id, lv, level: f.level, quip: q });
    if (gotF.length) this.fx({ kind: 'drawn', to: f.id, cards: gotF });
    if (gotH.length) this.fx({ kind: 'drawn', to: h.id, cards: gotH });
    if (f.level >= WIN_LEVEL) {
      this.over = true; this.winner = f.id; this.phase = 'over';
      this.log(`${f.name} ottiene root. Partita finita al giro ${this.turn}.`, 'win');
      this.fx({ kind: 'gameover', winner: f.id, quip: this.say('gameover') });
    }
  }
  endCombat() {
    const c = this.combat; if (!c) return;
    c.threats.forEach(t => this.discard(t.card));
    this.fighter(c).penalty = 0;
    this.combat = null;
    if (!this.over) { this.phase = 'end'; this.setDeadline(this.to.turn); }
  }

  /* ---------- effetti ---------- */
  badText(effects) {
    return effects.map(e => {
      switch (e.k) {
        case 'lvl': return `perdi ${e.n} ${pl(e.n, 'livello', 'livelli')}`;
        case 'slot': return `perdi l'asset ${SLOTS[e.s]}`;
        case 'hand': return e.n >= 99 ? 'scarti tutta la mano' : `scarti ${e.n} ${pl(e.n, 'carta', 'carte')} a caso`;
        case 'gearAll': return 'perdi tutto l\'equipaggiamento';
        case 'role': return 'perdi il ruolo';
        case 'best': return 'perdi l\'asset con il bonus più alto';
        case 'penalty': return `−${e.n} al prossimo combattimento`;
        case 'wipe': return 'perdi equipaggiamento, ruolo e mano';
      }
      return '';
    }).join(', ');
  }
  applyBad(p, effects) {
    for (const e of effects) {
      switch (e.k) {
        case 'lvl': { const b = p.level; p.level = Math.max(1, p.level - e.n); if (b > p.level) this.log(`${p.name} perde ${b - p.level} ${pl(b - p.level, 'livello', 'livelli')}.`, 'bad'); break; }
        case 'slot': { const g = p.gear[e.s]; if (g) { p.gear[e.s] = null; this.discard(g); this.log(`${p.name} perde ${g.name}.`, 'bad'); } break; }
        case 'hand': { const n = Math.min(e.n, p.hand.length); for (let i = 0; i < n; i++) this.discard(p.hand.splice(this.rng(p.hand.length), 1)[0]); if (n) this.log(`${p.name} scarta ${n} ${pl(n, 'carta', 'carte')} dalla mano.`, 'bad'); break; }
        case 'gearAll': { const gs = this.gearOf(p); gs.forEach(g => this.discard(g)); p.gear = { hw: null, sw: null, cr: null, gd: null }; if (gs.length) this.log(`${p.name} perde tutto l'equipaggiamento.`, 'bad'); break; }
        case 'role': if (p.role) { this.log(`${p.name} perde il ruolo ${p.role.name}.`, 'bad'); this.discard(p.role); p.role = null; } break;
        case 'best': { const gs = this.gearOf(p).sort((a, b) => this.gBonus(p, b) - this.gBonus(p, a)); if (gs.length) { p.gear[gs[0].slot] = null; this.discard(gs[0]); this.log(`${p.name} perde ${gs[0].name}.`, 'bad'); } break; }
        case 'penalty': p.penalty += e.n; this.log(`${p.name} avrà −${e.n} al prossimo combattimento.`, 'bad'); break;
        case 'wipe': this.applyBad(p, [{ k: 'gearAll' }, { k: 'role' }, { k: 'hand', n: 99 }]); break;
      }
    }
  }
  curseMatters(p, card) {
    return card.bad.some(e => {
      switch (e.k) {
        case 'lvl': return p.level > 1;
        case 'slot': return !!p.gear[e.s];
        case 'hand': return p.hand.length > 0;
        case 'gearAll': case 'best': return this.gearOf(p).length > 0;
        case 'role': return !!p.role;
        default: return true;
      }
    });
  }
  addEsp(p) {
    if (this.isRole(p, 'social')) { this.log(`${p.name} sabota senza lasciare tracce (Ingegnere sociale).`, 'sys'); return; }
    p.esp++;
    if (p.esp >= ESP_MAX) {
      p.esp = 0;
      const b = p.level; p.level = Math.max(1, p.level - 1);
      this.log(`AUDIT DEL SOC su ${p.name}: troppe tracce nei log. ${b > p.level ? 'Perde 1 livello.' : 'È già al minimo.'}`, 'audit');
      this.fx({ kind: 'audit', pid: p.id, quip: this.say('audit') });
    }
  }
  applyCurse(t, card, by) {
    const sab = by && by !== t;
    if (sab) {
      this.log(`${by.name} gioca «${card.name}» su ${t.name}.`, 'sab');
      this.log(`«${card.d}»`, 'quip');
      this.fx({ kind: 'curse', by: by.id, target: t.id, card: card.name, text: this.badText(card.bad), d: card.d });
      this.addEsp(by);
    } else this.log(`${t.name} subisce «${card.name}».`, 'bad');
    if (this.isRole(t, 'blue') && !t.blueUsed && this.curseMatters(t, card)) {
      t.blueUsed = true; this.discard(card);
      this.log(`${t.name} (Blue Teamer) blocca la Sfiga.`, 'good');
      this.say('block');
      return;
    }
    this.applyBad(t, card.bad);
    this.discard(card);
  }

  /* ---------- timeout e azioni di default ---------- */
  worth(p, c) {
    switch (c.type) {
      case 'gear': { const eq = p.gear[c.slot]; return (!eq || this.gBonus(p, c) > this.gBonus(p, eq)) ? 20 + c.bonus : c.value / 100; }
      case 'oneshot': return c.escape ? 9 : 6 + c.bonus;
      case 'levelup': return p.level < 9 ? 30 : 1;
      case 'role': return p.role ? 2 : 15;
      case 'curse': return 7;
      case 'boost': return c.amt > 0 ? 6 + c.amt / 5 : 3;
      case 'lateral': return 4;
      case 'threat': return 3;
    }
    return 0;
  }
  autoDiscard(p) {
    const excess = p.hand.length - HAND_MAX;
    if (excess <= 0) return [];
    return [...p.hand].sort((a, b) => this.worth(p, a) - this.worth(p, b)).slice(0, excess).map(c => c.uid);
  }
  passiveAction(id) {
    const c = this.combat;
    if (c) {
      if (c.offer && c.offer.to === id) return { type: 'answerHelp', accept: false };
      if (c.step === 'prep' && c.fighter === id) return { type: 'fight' };
      if (c.step === 'window' && !c.passes.has(id)) return c.offer && c.offer.from === id ? { type: 'cancelHelp' } : { type: 'pass' };
      if (c.step === 'flee' && c.fighter === id) return { type: 'flee' };
      return null;
    }
    if (this.current.id !== id) return null;
    if (this.phase === 'open') return { type: 'openTicket' };
    return { type: 'endTurn', discard: this.autoDiscard(this.current) };
  }
  // Applica le azioni di default a chi ha lasciato scadere il tempo. Ritorna true se ha cambiato lo stato.
  timeout() {
    if (this.over) return false;
    const now = this.now();
    let did = false, guard = 0;
    const c = this.combat;
    if (c && c.offer && c.offerDeadline <= now) {
      const to = this.p(c.offer.to);
      this.log(`${to.name} non risponde alla richiesta di aiuto.`, 'sys');
      this.handle(to.id, { type: 'answerHelp', accept: false }); did = true;
    }
    while (!this.over && this.deadline <= now && guard++ < 20) {
      const id = this.needs().find(x => this.passiveAction(x));
      if (id === undefined) break;
      this.handle(id, this.passiveAction(id)); did = true;
    }
    return did;
  }

  /* ---------- vista per giocatore (niente mani altrui, niente mazzi) ---------- */
  view(pid) {
    const me = this.players.find(p => p.id === pid);
    const c = this.combat, now = this.now();
    return {
      gid: this.id, version: this.version, turn: this.turn, cur: this.current.id, phase: this.phase, over: this.over, winner: this.winner,
      handMax: HAND_MAX, espMax: ESP_MAX,
      deck: { T: this.decks.T.length, A: this.decks.A.length },
      players: this.players.map(p => ({
        id: p.id, name: p.name, isBot: p.isBot, seat: p.seat, level: p.level, title: TITLES[p.level], esp: p.esp, credit: p.credit,
        penalty: p.penalty, role: p.role, gear: p.gear, handCount: p.hand.length, power: this.basePower(p),
        blueReady: this.isRole(p, 'blue') && !p.blueUsed,
        gearBonus: Object.fromEntries(Object.entries(p.gear).filter(([, g]) => g).map(([s, g]) => [s, this.gBonus(p, g)]))
      })),
      hand: me ? me.hand : [],
      revealed: this.revealed,
      combat: c ? {
        fighter: c.fighter, helper: c.helper, share: c.share, step: c.step, passes: [...c.passes], offer: c.offer,
        threats: c.threats.map(t => ({ card: t.card, mod: t.mod, eff: t.card.l + this.vsBonus(t.card, this.fighter(c)) })),
        fBonus: c.fBonus, mBonus: c.mBonus, ev: c.ev.slice(-12), asked: c.asked,
        fighterPower: this.cFighterPower(c), threatPower: this.cThreatPower(c), winning: this.cWinning(c),
        treasures: this.cTreasures(c), levels: this.cLevels(c)
      } : null,
      needs: this.needs(),
      deadlineIn: this.over ? null : Math.max(0, this.deadline - now),
      offerIn: c && c.offer ? Math.max(0, c.offerDeadline - now) : null,
      log: this.logs.slice(-80),
      fx: this.fxs.filter(e => !e.to || e.to === pid).slice(-30)
    };
  }
}

module.exports = { Game, GameError, DEFAULT_TIMEOUTS };
