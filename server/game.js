'use strict';
// Motore di gioco autoritativo. Il client non decide nulla: invia intenzioni,
// il server le valida contro lo stato e manda a ciascuno solo ciò che può vedere.

const crypto = require('crypto');
const { TITLES, SLOTS, ROLES, QUIPS, buildDecks, badText } = require('./cards');

const HAND_MAX = 5, ESP_MAX = 4, WIN_LEVEL = 10;
const HELP_COUNTERS = 3; // controproposte ammesse in una trattativa di aiuto, poi si può solo accettare o rifiutare
const FROZEN = 'Change freeze: in questo combattimento non si gioca più niente. Si può solo passare.';
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
      role: null, gear: { hw: null, sw: null, cr: null, gd: null }, hand: [], blueUsed: false, skip: false, ooo: false
    }));
    this.id = crypto.randomBytes(4).toString('hex');
    this.logs = []; this.fxs = []; this.seq = 0; this.version = 0; this.quipBag = {}; this.quipLast = {};
    this.turn = 1; this.combat = null; this.revealed = null; this.over = false; this.winner = null;
    for (const p of this.players) p.hand.push(this.draw('T'), this.draw('T'), this.draw('T'), this.draw('A'), this.draw('A'));
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
  get helpCounters() { return HELP_COUNTERS; }
  draw(k) {
    const deck = this.decks[k], disc = this.disc[k];
    if (!deck.length && disc.length) { deck.push(...this.shuffle(disc.splice(0))); this.log(`Mazzo ${k === 'T' ? 'Ticket' : 'Asset'} rimescolato.`, 'sys'); }
    return deck.pop() || null;
  }
  discard(c) { if (c) this.disc[c.deck].push(c); }
  // Battute a sacchetto: tutte quelle di un tipo escono una volta prima che una si ripeta.
  quip(kind, key) {
    const k = QUIPS[kind + ':' + key] ? kind + ':' + key : kind, a = QUIPS[k];
    let bag = this.quipBag[k];
    if (!bag || !bag.length) {
      bag = this.quipBag[k] = this.shuffle(a.map((_, i) => i));
      if (bag.length > 1 && bag[bag.length - 1] === this.quipLast[k]) bag.unshift(bag.pop()); // niente bis a cavallo di due sacchetti
    }
    return a[this.quipLast[k] = bag.pop()];
  }
  say(kind, key) { const q = this.quip(kind, key); this.log(q, 'quip'); return q; }
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
  // con Pair programming la forza base di chi combatte conta doppio
  cFighterPower(c = this.combat) { const f = this.fighter(c), h = this.helper(c); return this.basePower(f) * (c.double ? 2 : 1) + c.fBonus - f.penalty + (h ? this.basePower(h) : 0); }
  cThreatPower(c = this.combat) { const f = this.fighter(c); return c.threats.reduce((s, t) => s + t.card.l + t.mod + this.vsBonus(t.card, f), 0) + c.mBonus; }
  cWinning(c = this.combat) { const a = this.cFighterPower(c), b = this.cThreatPower(c); return a > b || (a === b && this.isRole(this.fighter(c), 'red')); }
  cTreasures(c = this.combat) { return Math.max(0, c.threats.reduce((s, t) => s + t.card.tr + t.trMod, 0)); }
  cLevels(c = this.combat) { return c.threats.reduce((s, t) => s + t.card.lv + (t.lvMod || 0), 0); }
  threatNames(c = this.combat) { return c.threats.map(t => t.card.name + (t.copy ? ' (copia)' : '')).join(' + '); }

  /* ---------- chi deve agire ---------- */
  needs() {
    if (this.over) return [];
    const c = this.combat;
    if (!c) return [this.current.id];
    const out = [];
    if (c.step === 'prep') out.push(c.fighter);
    else if (c.step === 'window') {
      // giro dei «passo» in ordine di tavolo a partire da chi siede dopo chi combatte (che risponde per ultimo):
      // così, tra bot, non è sempre il primo della lista a decidere se sabotare
      const n = this.players.length, f = this.fighter(c).seat;
      for (let k = 1; k <= n; k++) { const p = this.players[(f + k) % n]; if (!c.passes.has(p.id)) out.push(p.id); }
    }
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
    const p = this.current; p.blueUsed = false; p.ooo = false; // la Risposta automatica dura fino al proprio turno
    this.log(`Turno di ${p.name}.`, 'turn');
    // Dotazione: chi è a livello 1 riceve un Asset a inizio turno. Gli Asset si vincono solo in combattimento,
    // quindi senza questo chi resta senza equipaggiamento non ha modo di rialzarsi.
    if (p.level === 1) {
      const c = this.draw('A');
      if (c) { p.hand.push(c); this.log(`Dotazione per ${p.name}, ancora guest: un Asset dall'IT.`, 'sys'); this.fx({ kind: 'drawn', to: p.id, cards: [c.name] }); }
    }
    this.setDeadline(this.to.turn);
  }
  a_openTicket(p) {
    this.ownFree(p);
    if (this.phase !== 'open') fail('Hai già aperto il ticket di questo turno.');
    const card = this.draw('T');
    if (!card) { this.phase = 'after'; this.setDeadline(this.to.turn); this.log('Mazzo Ticket esaurito.', 'sys'); return; }
    this.log(`${p.name} apre un ticket: ${card.name}.`);
    this.revealed = { card, by: p.id };
    if (card.type === 'threat') { if (card.d) this.log(`«${card.d}»`, 'quip'); return this.startCombat(p, [card]); }
    // Solo le Minacce si affrontano subito: tutto il resto, Sfighe comprese, va in mano a chi ha aperto il ticket.
    p.hand.push(card);
    this.log(`Nessuna minaccia: ${p.name} si tiene la carta.`, 'sys');
    this.fx({ kind: 'kept', to: p.id, card: card.name });
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
    this.advance();
  }
  // Passa al prossimo giocatore. Chi deve saltare il turno lo salta qui, e il segnalino si consuma.
  advance() {
    for (let k = 0; k < this.players.length; k++) {
      this.cur = (this.cur + 1) % this.players.length;
      if (this.cur === this.startSeat) this.turn++;
      const n = this.current;
      if (!n.skip) break;
      n.skip = false; n.ooo = false;
      this.log(`${n.name} salta il turno.`, 'bad');
      this.fx({ kind: 'skip', pid: n.id, quip: this.say('skipped') });
    }
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
    const k = this.combat;
    if (k && k.frozen && (t.id === k.fighter || t.id === k.helper)) fail(FROZEN);
    this.removeFromHand(p, card);
    this.applyCurse(t, card, p);
    // una Sfiga su chi combatte o su chi aiuta cambia le forze: come ogni altra carta, riapre il giro dei «passo»
    const c = this.combat;
    if (c && c.step === 'window' && (t.id === c.fighter || t.id === c.helper)) this.touch(c);
  }

  /* ---------- combattimento ---------- */
  startCombat(f, cards) {
    this.combat = {
      fighter: f.id, threats: cards.map(card => ({ card, mod: 0, trMod: 0, lvMod: 0 })), fBonus: 0, mBonus: 0,
      helper: null, share: 0, ev: [], step: 'prep', passes: new Set(), offer: null, offerDeadline: 0, asked: [], mood: {},
      frozen: false, lastSab: null, reassigned: false
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
    this.fx({ kind: 'window' });
  }
  a_play(p, a) {
    const c = this.combatPlay(p);
    const card = this.handCard(p, a.card, ['oneshot', 'boost', 'lateral']);
    const f = this.fighter(c), sabot = p !== f && p.id !== c.helper;
    let txt;
    if (card.type === 'oneshot') {
      if (card.escape) fail('Il Rollback si usa al momento della fuga.');
      if (a.side !== 'f' && a.side !== 'm') fail('Scegli a chi dare il bonus.');
      if (a.side === 'f') c.fBonus += card.bonus; else c.mBonus += card.bonus;
      txt = `${p.name}: ${card.name} (+${card.bonus} ${a.side === 'f' ? 'a ' + f.name : 'alla minaccia'})`;
      this.removeFromHand(p, card); this.discard(card);
      if (a.side === 'm' && sabot) this.sabotage(p, txt, card, () => { c.mBonus -= card.bonus; }); else this.cEv(c, txt);
    } else if (card.type === 'boost') {
      const t = c.threats[c.threats.length - 1], lv = card.lv || 0;
      t.mod += card.amt; t.trMod += card.tr; t.lvMod += lv;
      txt = `${p.name}: ${card.name} (${card.amt > 0 ? '+' : ''}${card.amt} alla minaccia${lv ? `, +${lv} ${pl(lv, 'livello', 'livelli')} in palio` : ''})`;
      this.removeFromHand(p, card); this.discard(card);
      if (card.amt > 0 && sabot) this.sabotage(p, txt, card, () => { t.mod -= card.amt; t.trMod -= card.tr; t.lvMod -= lv; }); else this.cEv(c, txt);
    } else {
      const th = this.handCard(p, a.threat, 'threat');
      this.removeFromHand(p, card); this.removeFromHand(p, th); this.discard(card);
      c.threats.push({ card: th, mod: 0, trMod: 0, lvMod: 0 });
      txt = `${p.name}: Movimento laterale, entra ${th.name} (forza ${th.l}). «${th.d}»`;
      if (sabot) this.sabotage(p, txt, card, () => { const i = c.threats.findIndex(x => x.card === th); if (i > 0) { c.threats.splice(i, 1); this.discard(th); } });
      else this.cEv(c, txt);
    }
    this.touch(c);
  }
  cEv(c, txt, cls = '') { c.ev.push(txt); this.log(txt, cls); }
  // `undo` rimette le cose com'erano: serve all'Honeypot, che annulla l'ultimo sabotaggio.
  sabotage(p, txt, card, undo = null) {
    const c = this.combat;
    this.cEv(c, txt, 'sab');
    const q = card.type === 'trick' ? this.say('trick', card.fx) : this.say('sabotage', card.name);
    this.fx({ kind: 'sabotage', by: p.id, target: c.fighter, text: txt, quip: q });
    c.lastSab = undo ? { by: p.id, name: card.name, undo } : null;
    this.addEsp(p);
  }
  // Chi può giocare una carta in combattimento adesso: chi combatte e chi aiuta sempre, gli altri solo a finestra aperta.
  combatPlay(p) {
    const c = this.inCombat(['prep', 'window']);
    if (c.frozen) fail(FROZEN);
    if (c.step === 'prep' && p.id !== c.fighter && p.id !== c.helper) fail('Gli altri possono interferire solo quando la finestra è aperta.');
    return c;
  }
  outsider(p, c = this.combat) { return p.id !== c.fighter && p.id !== c.helper; }
  spend(p, card) { this.removeFromHand(p, card); this.discard(card); }
  // La prima mossa ostile su chi è «fuori ufficio» o su un Blue Teamer con lo scudo pronto non passa.
  shielded(t, by, what) {
    if (t.ooo) {
      t.ooo = false;
      this.log(`${t.name} è fuori ufficio: ${what} torna a ${by.name}.`, 'good');
      this.say('bounce');
      return 'ooo';
    }
    if (this.isRole(t, 'blue') && !t.blueUsed) {
      t.blueUsed = true;
      this.log(`${t.name} (Blue Teamer) blocca ${what}.`, 'good');
      this.say('block');
      return 'blue';
    }
    return '';
  }

  /* ---------- carte speciali ---------- */
  a_trick(p, a) {
    const card = this.handCard(p, a.card, 'trick');
    const fn = this['t_' + card.fx];
    if (typeof fn !== 'function') fail('Carta non giocabile.');
    fn.call(this, p, card, a);
  }
  target(p, a) { const t = this.p(a.target); if (t === p) fail('Scegli un altro giocatore.'); return t; }
  t_poach(p, card) {
    const c = this.combatPlay(p);
    if (!c.helper) fail('Non c\'è nessun aiutante da portare via.');
    if (!this.outsider(p, c)) fail('Si gioca sul combattimento di un altro.');
    const h = this.helper(c), share = c.share;
    c.helper = null; c.share = 0;
    this.spend(p, card);
    this.sabotage(p, `${p.name}: ${card.name} porta via ${h.name} dal combattimento`, card, () => { if (!c.helper) { c.helper = h.id; c.share = share; } });
    this.touch(c);
  }
  t_freeze(p, card) {
    const c = this.combatPlay(p);
    if (c.step !== 'window') fail('Il Change freeze si gioca a finestra aperta.');
    if (this.fighter(c).level + this.cLevels(c) >= WIN_LEVEL) fail('Quando c\'è di mezzo root nessun change freeze regge.');
    c.frozen = true; c.offer = null;
    this.spend(p, card);
    this.cEv(c, `${p.name}: Change freeze. Da ora nessuno gioca più carte in questo combattimento`, 'sys');
    this.fx({ kind: 'freeze', by: p.id, quip: this.say('trick', 'freeze') });
    this.touch(c);
  }
  t_honeypot(p, card) {
    const c = this.combatPlay(p), s = c.lastSab;
    if (!s) fail('Non c\'è nessun sabotaggio da annullare.');
    if (s.by === p.id) fail('Non puoi annullare un tuo sabotaggio.');
    c.lastSab = null; s.undo();
    this.spend(p, card);
    const by = this.p(s.by);
    this.cEv(c, `${p.name}: Honeypot, annullato «${s.name}» di ${by.name}`, 'good');
    this.fx({ kind: 'honeypot', by: p.id, target: by.id, card: s.name, quip: this.say('trick', 'honeypot') });
    this.addEsp(by);
    this.touch(c);
  }
  t_falsepos(p, card) {
    const c = this.combatPlay(p), f = this.fighter(c);
    if (this.outsider(p, c) && f.level + this.cLevels(c) >= WIN_LEVEL) fail('Chi sta per prendere root non si ferma con un falso positivo: servono carte vere.');
    const txt = `${p.name}: Falso positivo. Il combattimento contro ${this.threatNames(c)} è annullato: nessun premio, nessuna penalità`;
    this.spend(p, card);
    if (this.outsider(p, c) && this.cWinning(c)) this.sabotage(p, txt, card);
    else { this.cEv(c, txt); this.fx({ kind: 'falsepos', by: p.id, target: f.id, quip: this.say('trick', 'falsepos') }); }
    this.endCombat();
  }
  t_oncall(p, card, a) {
    const c = this.combatPlay(p);
    if (c.fighter !== p.id) fail('La giochi quando sei tu a combattere.');
    if (c.helper) fail('Hai già un aiutante.');
    const t = this.target(p, a);
    c.offer = null; c.helper = t.id; c.share = 0;
    this.spend(p, card);
    this.cEv(c, `${p.name}: Turno di reperibilità, ${t.name} aiuta gratis (+${this.basePower(t)})`, 'good');
    this.fx({ kind: 'oncall', by: p.id, target: t.id, quip: this.say('trick', 'oncall') });
    this.touch(c);
  }
  t_scapegoat(p, card, a) {
    const c = this.inCombat(['flee']);
    if (c.fighter !== p.id) fail('La giochi quando sei tu a dover fuggire.');
    const t = this.target(p, a);
    this.spend(p, card);
    this.log(`${p.name} indica ${t.name} come capro espiatorio.`, 'sab');
    this.say('trick', 'scapegoat');
    this.fx({ kind: 'scapegoat', by: p.id, target: t.id });
    this.addEsp(p);
    this.flee(p, c, this.shielded(t, p, 'lo scaricabarile') ? p : t);
  }
  t_ooo(p, card) {
    if (p.ooo) fail('La Risposta automatica è già attiva.');
    p.ooo = true;
    this.spend(p, card);
    this.log(`${p.name} attiva la Risposta automatica: la prossima Sfiga torna al mittente.`);
    this.say('trick', 'ooo');
  }
  t_ai(p, card, a) {
    const c = this.combatPlay(p), f = this.fighter(c);
    if (a.side !== 'f' && a.side !== 'm') fail('Scegli a chi dare il risultato.');
    const roll = 1 + this.rng(6), amt = roll === 1 ? -3 : roll === 6 ? 8 : roll, sabot = this.outsider(p, c) && a.side === 'm';
    if (a.side === 'f') c.fBonus += amt; else c.mBonus += amt;
    this.spend(p, card);
    const txt = `${p.name}: Chiedo all'IA, dado ${roll}: ${amt > 0 ? '+' : '−'}${Math.abs(amt)} ${a.side === 'f' ? 'a ' + f.name : 'alla minaccia'}`;
    this.fx({ kind: 'ai', by: p.id, roll, amt, side: a.side });
    if (sabot && amt > 0) this.sabotage(p, txt, card, () => { c.mBonus -= amt; });
    else { this.cEv(c, txt, sabot ? 'sab' : ''); this.say('trick', amt < 0 ? 'aiKo' : 'ai'); if (sabot) this.addEsp(p); }
    this.touch(c);
  }
  t_reboot(p, card) {
    const c = this.combatPlay(p), was = this.cWinning(c);
    c.fBonus = 0; c.mBonus = 0; c.lastSab = null; c.double = false;
    c.threats.forEach(t => { t.mod = 0; t.trMod = 0; t.lvMod = 0; });
    this.spend(p, card);
    const txt = `${p.name}: Spegni e riaccendi. Azzerati tutti i bonus e le interferenze`;
    if (this.outsider(p, c) && was && !this.cWinning(c)) this.sabotage(p, txt, card);
    else { this.cEv(c, txt); this.fx({ kind: 'reboot', by: p.id, quip: this.say('trick', 'reboot') }); }
    this.touch(c);
  }
  t_mate(p, card) {
    const c = this.combatPlay(p), t = c.threats[c.threats.length - 1];
    const copy = { card: t.card, mod: t.mod, trMod: t.trMod, lvMod: t.lvMod, copy: true };
    c.threats.push(copy);
    this.spend(p, card);
    const txt = `${p.name}: Il malware era nel backup, ${t.card.name} si duplica (forza ${t.card.l + t.mod})`;
    if (this.outsider(p, c)) this.sabotage(p, txt, card, () => { const i = c.threats.indexOf(copy); if (i > 0) c.threats.splice(i, 1); });
    else { this.cEv(c, txt); this.say('trick', 'mate'); }
    this.touch(c);
  }
  t_double(p, card) {
    const c = this.combatPlay(p);
    if (c.double) fail('Pair programming è già in corso in questo combattimento.');
    c.double = true;
    this.spend(p, card);
    const f = this.fighter(c);
    this.cEv(c, `${p.name}: Pair programming, la forza base di ${f.name} conta doppio (+${this.basePower(f)})`, 'good');
    this.say('trick', 'double');
    this.touch(c);
  }
  t_standoff(p, card) {
    const c = this.combatPlay(p), f = this.fighter(c);
    if (c.step !== 'window') fail('L\'escalation al management si gioca a finestra aperta.');
    if (this.isRole(f, 'red')) fail('Contro un Red Teamer il pareggio non basta: vince lui.');
    const delta = this.cFighterPower(c) - this.cThreatPower(c), was = this.cWinning(c);
    if (!delta) fail('Le due parti sono già in pareggio.');
    c.mBonus += delta;
    this.spend(p, card);
    const txt = `${p.name}: Escalation al management, la minaccia sale a ${this.cThreatPower(c)}: pareggio`;
    if (this.outsider(p, c) && was) this.sabotage(p, txt, card, () => { c.mBonus -= delta; });
    else { this.cEv(c, txt); this.say('trick', 'standoff'); }
    this.touch(c);
  }
  t_lunch(p, card) {
    const c = this.combatPlay(p), f = this.fighter(c);
    if (this.outsider(p, c) && f.level + this.cLevels(c) >= WIN_LEVEL) fail('Chi sta per prendere root non va in pausa pranzo.');
    this.spend(p, card);
    const txt = `${p.name}: Pausa pranzo. ${this.threatNames(c)} se ne va: ${f.name} incassa i tesori, niente livelli`;
    if (this.outsider(p, c) && this.cWinning(c)) this.sabotage(p, txt, card);
    else { this.cEv(c, txt); this.say('trick', 'lunch'); }
    this.resolveWin(c, false);
    this.endCombat();
  }
  t_cascade(p, card) {
    const c = this.combatPlay(p);
    this.spend(p, card);
    let th = null;
    for (let i = 0; i < 40 && !th; i++) {
      const x = this.draw('T'); if (!x) break;
      if (x.type === 'threat') th = x; else this.discard(x);
    }
    if (!th) { this.cEv(c, `${p.name}: Alert a cascata, ma nel mazzo non c'è nessuna minaccia`); return this.touch(c); }
    const entry = { card: th, mod: 0, trMod: 0, lvMod: 0 };
    c.threats.push(entry);
    const txt = `${p.name}: Alert a cascata, entra ${th.name} (forza ${th.l})`;
    if (this.outsider(p, c)) this.sabotage(p, txt, card, () => { const i = c.threats.indexOf(entry); if (i > 0) { c.threats.splice(i, 1); this.discard(th); } });
    else { this.cEv(c, txt); this.say('trick', 'cascade'); }
    this.touch(c);
  }
  t_reassign(p, card, a) {
    const c = this.inCombat(['prep']);
    if (c.fighter !== p.id) fail('La giochi quando sei tu a combattere.');
    if (c.reassigned) fail('Questo ticket è già stato riassegnato una volta.');
    if (c.helper || c.offer) fail('Prima chiudi la questione dell\'aiuto.');
    const t = this.target(p, a);
    this.spend(p, card);
    this.log(`${p.name} riassegna il ticket a ${t.name}.`, 'sab');
    this.say('trick', 'reassign');
    this.addEsp(p);
    c.reassigned = true;
    if (this.shielded(t, p, 'il ticket')) { this.setDeadline(this.to.prep); return; }
    c.fighter = t.id; c.fBonus = 0; c.asked = []; c.mood = {}; c.passes.clear(); c.lastSab = null;
    this.log(`${t.name} eredita il ticket: affronta ${this.threatNames(c)} (forza ${this.cThreatPower(c)}).`, 'fight');
    this.fx({ kind: 'reassign', by: p.id, target: t.id, threat: this.threatNames(c) });
    this.setDeadline(this.to.prep);
  }
  a_pass(p) {
    const c = this.inCombat(['window']);
    if (c.passes.has(p.id)) fail('Hai già passato.');
    c.passes.add(p.id);
    this.log(`${p.name} passa.`);
    this.fx({ kind: 'pass', pid: p.id });
    this.maybeClose();
  }
  a_askHelp(p, a) {
    const c = this.inCombat(['prep', 'window']);
    if (c.fighter !== p.id) fail('Solo chi combatte può chiedere aiuto.');
    if (c.frozen) fail(FROZEN);
    if (c.helper) fail('Hai già un aiutante.');
    if (c.offer) fail('C\'è già una richiesta in sospeso.');
    const to = this.p(a.to);
    if (to === p) fail('Non puoi aiutarti da solo.');
    const tr = this.cTreasures(c);
    if (!isInt(a.share) || a.share < 0 || a.share > tr) fail(`L'offerta deve essere tra 0 e ${tr} tesori.`);
    this.propose(c, { from: p.id, to: to.id, share: a.share, round: 0 });
    if (!c.asked.includes(to.id)) c.asked.push(to.id);
    this.log(`${p.name} chiede aiuto a ${to.name} offrendo ${a.share} ${pl(a.share, 'tesoro', 'tesori')}.`);
    this.fx({ kind: 'helpAsk', from: p.id, target: to.id, share: a.share });
  }
  // Una proposta in sospeso: `from` l'ha fatta, `to` deve rispondere. Il timer del combattimento
  // non scade mentre si tratta, e a trattativa chiusa resta qualche secondo per reagire.
  propose(c, offer) {
    c.offer = offer;
    c.offerDeadline = this.now() + this.to.offer;
    this.deadline = Math.max(this.deadline, c.offerDeadline + Math.round(this.to.offer / 2));
  }
  // Chi riceve una proposta può rilanciare con un'altra cifra: i ruoli si invertono e risponde l'altro.
  a_counterHelp(p, a) {
    const c = this.combat;
    if (!c || !c.offer || c.offer.to !== p.id) fail('Nessuna proposta a cui rispondere.');
    const o = c.offer, tr = this.cTreasures(c);
    if (o.round >= HELP_COUNTERS) fail('Trattativa al limite: accetta o rifiuta.');
    if (!isInt(a.share) || a.share < 0 || a.share > tr) fail(`La controproposta deve essere tra 0 e ${tr} tesori.`);
    if (a.share === o.share) fail('Proponi una cifra diversa, oppure accetta.');
    this.propose(c, { from: p.id, to: o.from, share: a.share, round: o.round + 1 });
    this.log(`${p.name} rilancia con ${this.p(o.from).name}: ${a.share} ${pl(a.share, 'tesoro', 'tesori')} all'aiutante.`);
    this.fx({ kind: 'helpCounter', from: p.id, target: o.from, share: a.share });
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
    // dopo una controproposta può essere chi combatte a rispondere: l'aiutante è sempre l'altro
    const h = this.p(o.from === c.fighter ? o.to : o.from);
    if (a.accept) {
      c.helper = h.id; c.share = o.share;
      this.cEv(c, `${h.name} si unisce al combattimento (+${this.basePower(h)}) per ${o.share} ${pl(o.share, 'tesoro', 'tesori')}`, 'good');
      this.say('helpYes');
      this.touch(c);
    } else {
      this.log(p === h ? `${p.name} rifiuta di aiutare ${this.fighter(c).name}.` : `${p.name} rifiuta la controproposta di ${h.name}.`);
      this.fx({ kind: 'helpNo', by: p.id, to: o.from, quip: this.say(p === h ? 'helpNo' : 'counterNo') });
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
    this.flee(p, c, p);
  }
  // Un tiro per minaccia. Con il Capro espiatorio la penalità di chi viene preso la paga `victim`.
  flee(p, c, victim) {
    for (const t of c.threats) {
      const need = Math.min(6, Math.max(2, (this.isRole(p, 'sys') ? 3 : 5) - t.card.flee));
      const roll = 1 + this.rng(6), ok = roll >= need, scape = victim !== p;
      this.log(`${p.name} tenta la fuga da ${t.card.name}: ${roll} (serve ${need}+), ${ok ? 'scappa' : scape ? `preso, ma paga ${victim.name}` : 'preso'}.`, ok ? '' : 'bad');
      const q = !ok && scape ? '' : this.say(ok ? 'fleeOk' : 'fleeKo', t.card.bad[0].s && t.card.bad[0].k === 'slot' ? t.card.bad[0].s : t.card.bad[0].k);
      this.fx({ kind: 'roll', pid: p.id, threat: t.card.name, roll, need, ok, bad: ok ? '' : this.badText(t.card.bad), quip: q, victim: scape ? victim.id : null });
      if (!ok) this.applyBad(victim, t.card.bad);
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
  // levels = false: Pausa pranzo, si incassano i tesori ma non i livelli
  resolveWin(c, levels = true) {
    const f = this.fighter(c), h = this.helper(c), tr = this.cTreasures(c), lv = levels ? this.cLevels(c) : 0;
    const share = h ? Math.min(tr, c.share) : 0;
    const gotH = [], gotF = [];
    for (let i = 0; i < share; i++) { const x = this.draw('A'); if (x) { h.hand.push(x); gotH.push(x.name); } }
    for (let i = share; i < tr; i++) { const x = this.draw('A'); if (x) { f.hand.push(x); gotF.push(x.name); } }
    f.level = Math.min(WIN_LEVEL, f.level + lv);
    this.log(levels ? `${f.name} neutralizza ${this.threatNames(c)}: +${lv} ${pl(lv, 'livello', 'livelli')}, ${tr} ${pl(tr, 'tesoro', 'tesori')}.` : `${f.name} incassa ${tr} ${pl(tr, 'tesoro', 'tesori')} senza combattere: la minaccia è a pranzo.`, 'good');
    const q = f.level >= WIN_LEVEL || !levels ? '' : this.say('win');
    if (h) this.log(`${h.name} incassa ${share} ${pl(share, 'tesoro', 'tesori')} per l'aiuto.`);
    if (levels) this.fx({ kind: 'win', pid: f.id, lv, level: f.level, quip: q });
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
    c.threats.forEach(t => { if (!t.copy) this.discard(t.card); }); // le copie del Malware nel backup non sono carte vere
    this.fighter(c).penalty = 0;
    this.combat = null;
    if (!this.over) { this.phase = 'end'; this.setDeadline(this.to.turn); }
  }

  /* ---------- effetti ---------- */
  badText(effects) { return badText(effects); }
  randomOther(p) { const o = this.players.filter(x => x !== p); return o[this.rng(o.length)]; }
  bestGear(p) { return this.gearOf(p).sort((a, b) => this.gBonus(p, b) - this.gBonus(p, a))[0] || null; }
  // sposta n carte a caso dalla mano di `from` a quella di `to`; ritorna quante ne ha spostate
  moveCards(from, to, n) {
    const got = [];
    for (let i = 0; i < n && from.hand.length; i++) got.push(from.hand.splice(this.rng(from.hand.length), 1)[0]);
    to.hand.push(...got);
    if (got.length) this.fx({ kind: 'drawn', to: to.id, cards: got.map(c => c.name) });
    return got.length;
  }
  // `by` è chi ha giocato la carta (solo per le Sfighe): serve agli effetti che coinvolgono il mittente.
  applyBad(p, effects, by = null) {
    for (const e of effects) {
      switch (e.k) {
        case 'skip': if (!p.skip) { p.skip = true; this.log(`${p.name} salterà il prossimo turno.`, 'bad'); } break;
        case 'esp': this.log(`${p.name}: +${e.n} Esposizione.`, 'bad'); for (let i = 0; i < e.n; i++) this.addEsp(p, true); break;
        case 'credit': if (p.credit) { this.log(`${p.name} perde ${p.credit} di credito.`, 'bad'); p.credit = 0; } break;
        case 'robbed': { const o = this.randomOther(p), n = this.moveCards(p, o, e.n); if (n) this.log(`${o.name} prende ${n} ${pl(n, 'carta', 'carte')} dalla mano di ${p.name}.`, 'bad'); break; }
        case 'give': {
          const gs = this.gearOf(p), g = e.s === 'best' ? this.bestGear(p) : e.s ? p.gear[e.s] : gs[this.rng(gs.length || 1)];
          if (g) { const o = this.randomOther(p); p.gear[g.slot] = null; o.hand.push(g); this.log(`${g.name} passa da ${p.name} a ${o.name}.`, 'bad'); this.fx({ kind: 'drawn', to: o.id, cards: [g.name] }); }
          break;
        }
        case 'all': this.log(`Tutti scartano ${e.n} ${pl(e.n, 'carta', 'carte')}.`, 'bad'); for (const q of this.players) for (let i = 0; i < e.n && q.hand.length; i++) this.discard(q.hand.splice(this.rng(q.hand.length), 1)[0]); break;
        case 'swapHand': { const o = this.randomOther(p); [p.hand, o.hand] = [o.hand, p.hand]; this.log(`${p.name} e ${o.name} si scambiano la mano.`, 'bad'); this.fx({ kind: 'swap', a: p.id, b: o.id }); break; }
        case 'unequip': { const g = this.bestGear(p); if (g) { p.gear[g.slot] = null; p.hand.push(g); this.log(`${p.name} deve rimettere in mano ${g.name}.`, 'bad'); } break; }
        case 'steal': if (by) { const n = this.moveCards(p, by, e.n); if (n) this.log(`${by.name} prende ${n} ${pl(n, 'carta', 'carte')} dalla mano di ${p.name}.`, 'bad'); } break;
        case 'swapRole': if (by && (p.role || by.role)) { [p.role, by.role] = [by.role, p.role]; this.log(`${p.name} e ${by.name} si scambiano il ruolo.`, 'bad'); } break;
        case 'handover': if (by) { [p.hand, by.hand] = [by.hand, p.hand]; this.log(`${p.name} e ${by.name} si scambiano la mano.`, 'bad'); this.fx({ kind: 'swap', a: p.id, b: by.id }); } break;
        case 'lvl': { const b = p.level; p.level = Math.max(1, p.level - e.n); if (b > p.level) this.log(`${p.name} perde ${b - p.level} ${pl(b - p.level, 'livello', 'livelli')}.`, 'bad'); break; }
        case 'slot': { const g = p.gear[e.s]; if (g) { p.gear[e.s] = null; this.discard(g); this.log(`${p.name} perde ${g.name}.`, 'bad'); } break; }
        case 'hand': { const n = Math.min(e.n, p.hand.length); for (let i = 0; i < n; i++) this.discard(p.hand.splice(this.rng(p.hand.length), 1)[0]); if (n) this.log(`${p.name} scarta ${n} ${pl(n, 'carta', 'carte')} dalla mano.`, 'bad'); break; }
        case 'gearAll': { const gs = this.gearOf(p); gs.forEach(g => this.discard(g)); p.gear = { hw: null, sw: null, cr: null, gd: null }; if (gs.length) this.log(`${p.name} perde tutto l'equipaggiamento.`, 'bad'); break; }
        case 'role': if (p.role) { this.log(`${p.name} perde il ruolo ${p.role.name}.`, 'bad'); this.discard(p.role); p.role = null; } break;
        case 'best': { const g = this.bestGear(p); if (g) { p.gear[g.slot] = null; this.discard(g); this.log(`${p.name} perde ${g.name}.`, 'bad'); } break; }
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
        case 'skip': return !p.skip;
        case 'credit': return p.credit > 0;
        case 'robbed': case 'steal': return p.hand.length > 0;
        case 'give': case 'unequip': return e.s && e.s !== 'best' ? !!p.gear[e.s] : this.gearOf(p).length > 0;
        default: return true;
      }
    });
  }
  // `forced`: Esposizione presa come penalità, non per un sabotaggio: vale anche per l'Ingegnere sociale.
  addEsp(p, forced = false) {
    if (!forced && this.isRole(p, 'social')) { this.log(`${p.name} sabota senza lasciare tracce (Ingegnere sociale).`, 'sys'); return; }
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
    this.discard(card);
    if (sab && t.ooo) {
      // Risposta automatica: la Sfiga torna a chi l'ha mandata (gli effetti che richiedono un mittente svaniscono)
      t.ooo = false;
      this.log(`${t.name} è fuori ufficio: «${card.name}» torna a ${by.name}.`, 'good');
      this.fx({ kind: 'bounce', by: t.id, target: by.id, card: card.name, text: this.badText(card.bad), quip: this.say('bounce') });
      this.applyBad(by, card.bad);
      return;
    }
    if (sab && this.isRole(t, 'blue') && !t.blueUsed && this.curseMatters(t, card)) {
      t.blueUsed = true;
      this.log(`${t.name} (Blue Teamer) blocca la Sfiga.`, 'good');
      this.say('block');
      return;
    }
    this.applyBad(t, card.bad, sab ? by : null);
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
      case 'trick': return 7;
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
      this.log(`${to.name} non risponde alla ${c.offer.round ? 'controproposta' : 'richiesta di aiuto'}.`, 'sys');
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
        penalty: p.penalty, role: p.role, gear: p.gear, handCount: p.hand.length, power: this.basePower(p), skip: p.skip, ooo: p.ooo,
        blueReady: this.isRole(p, 'blue') && !p.blueUsed,
        gearBonus: Object.fromEntries(Object.entries(p.gear).filter(([, g]) => g).map(([s, g]) => [s, this.gBonus(p, g)]))
      })),
      hand: me ? me.hand : [],
      revealed: this.revealed,
      combat: c ? {
        fighter: c.fighter, helper: c.helper, share: c.share, step: c.step, passes: [...c.passes], offer: c.offer ? { ...c.offer, canCounter: c.offer.round < HELP_COUNTERS } : null,
        threats: c.threats.map(t => ({ card: t.card, mod: t.mod, copy: !!t.copy, eff: t.card.l + this.vsBonus(t.card, this.fighter(c)) })),
        fBonus: c.fBonus, mBonus: c.mBonus, ev: c.ev.slice(-12), asked: c.asked,
        frozen: c.frozen, reassigned: c.reassigned, double: !!c.double, lastSab: c.lastSab ? { by: c.lastSab.by, name: c.lastSab.name } : null,
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
