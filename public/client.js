'use strict';
// Client di ESCALATION. Non contiene regole: mostra lo stato che arriva dal server
// e invia intenzioni. Ogni azione viene validata dal server.
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const pl = (n, s, p) => (n === 1 ? s : p);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage non disponibile */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage non disponibile */ } }
  };

  const SLOTS = { hw: 'Hardware', sw: 'Software', cr: 'Credenziali', gd: 'Gadget' };
  const ROLES = {
    red: { name: 'Red Teamer', text: 'Vinci anche i pareggi in combattimento.' },
    sys: { name: 'Sysadmin', text: 'La fuga riesce con 4 o più invece che con 5.' },
    blue: { name: 'Blue Teamer', text: 'La prima Sfiga che ti colpisce in ogni giro viene bloccata.' },
    social: { name: 'Ingegnere sociale', text: 'I tuoi sabotaggi non aumentano l\'Esposizione.' }
  };
  const params = new URLSearchParams(location.search);
  const S = {
    ws: null, online: false, retry: 0, stop: false, connecting: false, retryTimer: null, actPending: false, focusEl: null,
    session: store.get('esc-session'), you: null, room: null, view: null,
    gid: null, lastFx: 0, deadlineAt: 0, offerAt: 0, logOpen: false, modal: null, offerShown: null,
    autopass: store.get('esc-autopass') !== false, apTimer: null, apKey: null,
    form: { name: store.get('esc-name') || '', code: (params.get('r') || '').toUpperCase().slice(0, 5) }
  };

  /* ================= connessione ================= */
  function connect() {
    if (S.stop || S.connecting) return;
    if (S.ws && (S.ws.readyState === 0 || S.ws.readyState === 1)) return;
    clearTimeout(S.retryTimer); S.retryTimer = null;
    S.connecting = true;
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    S.ws = ws;
    ws.onopen = () => {
      S.connecting = false; S.online = true; S.retry = 0;
      if (S.session) send({ t: 'resume', code: S.session.code, token: S.session.token });
      render();
    };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } onMsg(m); };
    ws.onclose = e => {
      S.connecting = false; S.online = false; render();
      if (e.code === 4000) {
        S.stop = true;
        toast('Sessione su un altro dispositivo. Tocca qui per ricaricare.', 'warn', 20000, () => location.reload());
        return;
      }
      clearTimeout(S.retryTimer);
      S.retryTimer = setTimeout(connect, Math.min(10000, 500 * 2 ** S.retry++));
    };
  }
  function send(m) {
    if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(m));
    else toast('Connessione assente: riprovo a collegarmi…', 'warn');
  }
  function act(a) {
    if (S.actPending) return;
    if (!(S.ws && S.ws.readyState === 1)) return toast('Connessione assente: riprovo a collegarmi…', 'warn');
    S.actPending = true;
    S.ws.send(JSON.stringify({ t: 'act', a }));
  }
  function clearSession() { S.session = null; S.room = null; S.view = null; S.gid = null; S.actPending = false; store.del('esc-session'); closeModal(); }

  function onMsg(m) {
    switch (m.t) {
      case 'session':
        S.session = { code: m.code, token: m.token }; S.you = m.you; store.set('esc-session', S.session);
        if (location.search) history.replaceState(null, '', location.pathname);
        break;
      case 'sync': {
        S.actPending = false;
        S.room = m.room; S.you = m.room.you; S.view = m.view;
        if (m.view) {
          const fresh = S.gid !== m.view.gid;
          S.gid = m.view.gid;
          S.deadlineAt = m.view.deadlineIn != null ? Date.now() + m.view.deadlineIn : 0;
          S.offerAt = m.view.offerIn != null ? Date.now() + m.view.offerIn : 0;
          handleFx(m.view.fx, fresh);
        }
        render();
        afterSync();
        break;
      }
      case 'error': S.actPending = false; toast(m.msg, 'bad'); break;
      case 'expired': clearSession(); toast('Sessione scaduta: la stanza non esiste più.', 'warn'); render(); break;
      case 'kicked': clearSession(); toast('L\'host ti ha rimosso dalla stanza.', 'warn'); render(); break;
      case 'left': clearSession(); render(); break;
    }
  }

  /* ================= helper di stato ================= */
  const V = () => S.view;
  const P = id => S.view.players.find(p => p.id === id);
  const ME = () => P(S.you);
  const name = id => { const p = S.view && P(id); return p ? p.name : '?'; };
  const member = id => S.room.members.find(m => m.id === id);
  const passed = id => !!(V().combat && V().combat.passes.includes(id));
  const sumGear = p => Object.values(p.gearBonus || {}).reduce((s, n) => s + n, 0);

  /* ================= notifiche ================= */
  function toast(text, cls = '', ms = 4500, onClick) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + cls + (onClick ? ' clickable' : ''); el.textContent = text;
    if (onClick) el.addEventListener('click', onClick);
    box.prepend(el);
    while (box.children.length > 3) box.lastChild.remove();
    setTimeout(() => el.remove(), ms);
  }
  function handleFx(list, fresh) {
    const maxI = list.reduce((m, e) => Math.max(m, e.i), 0);
    if (fresh) { S.lastFx = maxI; return; }
    for (const e of list) if (e.i > S.lastFx) fxToast(e);
    S.lastFx = Math.max(S.lastFx, maxI);
  }
  function fxToast(e) {
    const me = S.you;
    switch (e.kind) {
      case 'roll':
        if (e.pid === me) toast(`Fuga da ${e.threat}: dado ${e.roll} (serviva ${e.need}+). ${e.ok ? 'Ti disconnetti in tempo.' : 'Ti prende: ' + e.bad + '.'} ${e.quip || ''}`, e.ok ? 'good' : 'bad', 8000);
        else toast(`${name(e.pid)} tenta la fuga da ${e.threat}: ${e.roll}, ${e.ok ? 'scappa' : 'preso'}.`);
        break;
      case 'sabotage': if (e.target === me) toast(`Sabotaggio: ${e.text}. ${e.quip || ''}`, 'bad', 7000); break;
      case 'helpNo': if (e.to === me) toast(`${name(e.by)} rifiuta. ${e.quip || ''}`, 'warn'); break;
      case 'curse':
        if (e.target === me) toast(`${name(e.by)} ti gioca «${e.card}»: ${e.text}. «${e.d || ''}»`, 'bad', 8000);
        else if (e.by !== me) toast(`${name(e.by)} gioca «${e.card}» su ${name(e.target)}.`);
        break;
      case 'audit': toast(e.pid === me ? `Audit del SOC: troppe tracce, perdi 1 livello. ${e.quip || ''}` : `Audit del SOC su ${name(e.pid)}. ${e.quip || ''}`, e.pid === me ? 'bad' : 'warn', 7000); break;
      case 'win': if (e.pid === me) toast(`Minaccia neutralizzata: sei a livello ${e.level}.${e.quip ? ' ' + e.quip : ''}`, 'good', 7000); break;
      case 'drawn': toast(`Peschi: ${e.cards.join(', ')}.`, 'good', 6000); break;
      case 'gameover': toast(`${e.winner === me ? 'Hai ottenuto root. Hai vinto.' : name(e.winner) + ' ha ottenuto root.'} ${e.quip || ''}`, e.winner === me ? 'good' : 'warn', 10000); break;
    }
  }

  /* ================= carte ================= */
  function badText(effects) {
    return effects.map(e => {
      switch (e.k) {
        case 'lvl': return `perdi ${e.n} ${pl(e.n, 'livello', 'livelli')}`;
        case 'slot': return `perdi l'asset ${SLOTS[e.s]}`;
        case 'hand': return e.n >= 99 ? 'scarti tutta la mano' : `scarti ${e.n} ${pl(e.n, 'carta', 'carte')}`;
        case 'gearAll': return 'perdi tutto l\'equipaggiamento';
        case 'role': return 'perdi il ruolo';
        case 'best': return 'perdi l\'asset migliore';
        case 'penalty': return `−${e.n} al prossimo combattimento`;
        case 'wipe': return 'perdi equipaggiamento, ruolo e mano';
      }
      return '';
    }).join(', ');
  }
  function cardHTML(c, opt = {}) {
    const src = '/cards/' + artSlug(c) + '.jpg';
    return `<button type="button" class="card k-${c.type}${opt.lg ? ' lg' : ''}${opt.mini ? ' mini' : ''}${opt.sel ? ' sel' : ''}" data-uid="${c.uid}"${opt.m ? ` data-m="${opt.m}"` : ''} aria-label="${esc(c.name)}"><img class="face" src="${src}" alt="">${cardTag(c) ? `<span class="tag">${cardTag(c)}</span>` : ''}</button>`;
  }
  function artSlug(c) {
    const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
    if (c.type === 'levelup') return 'level-' + slug(c.name);
    if (c.type === 'role') return 'role-' + (c.role || slug(c.name));
    if (c.type === 'gear') return 'gear-' + (c.slot || 'x') + '-' + slug(c.name);
    if (c.type === 'lateral') return 'lateral-movimento';
    return (c.type || 'card') + '-' + slug(c.name);
  }
  const KIND = { threat: 'Minaccia', curse: 'Sfiga', boost: 'Interferenza', lateral: 'Interferenza', role: 'Ruolo', gear: 'Asset', oneshot: 'Uso singolo', levelup: 'Carta livello' };
  function cardTag(c) {
    if (c.type === 'threat') return String(c.l);
    if (c.type === 'gear' || (c.type === 'oneshot' && !c.escape)) return '+' + c.bonus;
    if (c.type === 'boost') return (c.amt > 0 ? '+' : '') + c.amt;
    return '';
  }
  // Effetto (testo grande), penalità (rosso) e battuta (corsivo piccolo): usato da scheda, wiki e anteprima.
  function fxHTML(c) {
    const R = []; let bad = '';
    switch (c.type) {
      case 'threat':
        R.push(`Forza ${c.l}`, `Se vinci: +${c.lv} ${pl(c.lv, 'livello', 'livelli')} e ${c.tr} ${pl(c.tr, 'tesoro', 'tesori')}`);
        bad = `Se non scappi: ${badText(c.bad)}`;
        if (c.vs) R.push(`+${c.vs.n} contro ${(ROLES[c.vs.role] || { name: c.vs.role }).name}`);
        if (c.flee > 0) R.push(`Più facile da cui fuggire (+${c.flee} al dado)`);
        if (c.flee < 0) R.push(`Più difficile da cui fuggire (${c.flee} al dado)`);
        break;
      case 'curse': R.push(`Chi la subisce: ${badText(c.bad)}`, 'Giocabile su chiunque, in qualsiasi momento. Ti costa 1 punto di Esposizione.'); break;
      case 'role': R.push((ROLES[c.role] || { text: '' }).text, 'Un solo ruolo alla volta.'); break;
      case 'boost': R.push(`${c.amt > 0 ? '+' : ''}${c.amt} alla minaccia, ${c.tr > 0 ? '+' : ''}${c.tr} ${pl(Math.abs(c.tr), 'tesoro', 'tesori')}`, c.amt > 0 ? 'Sul combattimento di un altro è un sabotaggio: +1 Esposizione.' : 'Indebolisce la minaccia: nessuna Esposizione.'); break;
      case 'lateral': R.push('Durante un combattimento aggiunge una Minaccia dalla tua mano.', 'Sul combattimento di un altro è un sabotaggio: +1 Esposizione.'); break;
      case 'gear': R.push(`Slot ${SLOTS[c.slot]} · +${c.bonus} · valore ${c.value}`); if (c.roleBonus) R.push(`+${c.roleBonus.n} extra per ${(ROLES[c.roleBonus.role] || { name: c.roleBonus.role }).name}`); break;
      case 'oneshot': R.push(c.escape ? 'Quando devi fuggire: ti sganci senza tirare il dado.' : `+${c.bonus} a una delle due parti di un combattimento qualsiasi.`, `Valore ${c.value}`); break;
      case 'levelup': R.push('+1 livello nel tuo turno, fuori dal combattimento. Non porta a 10.'); break;
    }
    return `<p class="kind">${KIND[c.type] || ''}</p><ul class="fx">${R.map(r => `<li>${esc(r)}</li>`).join('')}</ul>${bad ? `<p class="pen">${esc(bad)}</p>` : ''}${c.d && c.type !== 'role' ? `<p class="flav">«${esc(c.d)}»</p>` : ''}`;
  }
  function cardDetail(c) {
    if (!c) return '';
    return `<div class="detail"><img class="zoom" src="/cards/${artSlug(c)}.jpg" alt="${esc(c.name)}">${fxHTML(c)}</div>`;
  }
  const espPips = p => `<span class="esp${p.esp >= V().espMax - 1 ? ' w3' : ''}" title="Esposizione ${p.esp}/${V().espMax}">${Array.from({ length: V().espMax }, (_, i) => `<i class="${i < p.esp ? 'on' : ''}"></i>`).join('')}</span>`;
  const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const cd = kind => `<span class="cd" data-cd="${kind}">${mmss((kind === 'offer' ? S.offerAt : S.deadlineAt) - Date.now())}</span>`;
  // Confronto senza i countdown: se il contenuto non cambia non si tocca il DOM (niente tap persi).
  const stable = html => html
    .replace(/<span class="cd" data-cd="(\w+)">[^<]*<\/span>/g, '[$1]')
    .replace(/(<span class="clock"[^>]*>)[^<]*(<\/span>)/g, '$1$2');
  function paint(el, html, key) {
    const k = stable(html);
    if (el[key] === k) return false;
    el[key] = k; el.innerHTML = html; return true;
  }

  /* ================= schermate ================= */
  function render() {
    const net = $('#netdot');
    net.className = 'dot' + (S.online ? ' on' : '');
    net.setAttribute('aria-label', S.online ? 'Online' : 'Offline');
    $('#bLeave').classList.toggle('hidden', !S.room);
    document.body.classList.toggle('ingame', !!(S.room && S.room.started && S.view));
    const scr = $('#screen');
    const oldHand = scr.querySelector('.hand'); const hs = oldHand ? oldHand.scrollLeft : 0;
    const logOld = scr.querySelector('#log'); const ls = logOld ? logOld.scrollTop : 0;
    let changed;
    if (!S.room) { $('#hinfo').textContent = ''; changed = paint(scr, homeHTML(), '_k'); }
    else if (!S.room.started || !S.view) { $('#hinfo').textContent = 'stanza ' + S.room.code; changed = paint(scr, lobbyHTML(), '_k'); }
    else {
      $('#hinfo').textContent = `${S.room.code} · giro ${S.view.turn}`;
      changed = paint(scr, gameHTML(), '_k');
    }
    if (changed) {
      hidePeek();
      const h = scr.querySelector('.hand'); if (h) h.scrollLeft = hs;
      const lg = scr.querySelector('#log'); if (lg) lg.scrollTop = ls;
      const f = scr.querySelector('#fName'); if (f && document.activeElement === document.body && !S.form.name) f.focus();
    }
    if (S.modal) renderModal();
  }

  function homeHTML() {
    return `<section class="panel"><h2>Gioca con i colleghi</h2>
      <p class="lead">Card game di sabotaggi e privilege escalation. Vince chi arriva a root per primo; perde chi lascia tracce nei log. Da 3 a 6 giocatori, con bot opzionali per i colleghi che «oggi non riescono».</p>
      <div class="field"><label for="fName">Il tuo nome</label><input id="fName" data-f="name" maxlength="20" autocomplete="nickname" value="${esc(S.form.name)}"></div>
      <button class="btn primary" type="button" data-do="create"${S.online ? '' : ' disabled'}>Crea una stanza</button></section>
      <section class="panel"><h2>Entra in una stanza</h2>
      <div class="field"><label for="fCode">Codice stanza</label><input id="fCode" data-f="code" maxlength="5" autocapitalize="characters" autocomplete="off" value="${esc(S.form.code)}"></div>
      <button class="btn" type="button" data-do="join"${S.online ? '' : ' disabled'}>Entra</button></section>
      ${S.online ? '' : '<p class="hint">Connessione al server in corso…</p>'}`;
  }

  function lobbyHTML() {
    const r = S.room, isHost = r.host === S.you, link = location.origin + '/?r=' + r.code;
    const lis = r.members.map(m => `<li><span class="nm">${esc(m.name)}</span>
      ${m.id === r.host ? '<span class="badge host">host</span>' : ''}${m.isBot ? '<span class="badge bot">bot</span>' : ''}${!m.connected ? '<span class="badge off">offline</span>' : ''}${m.id === S.you ? '<span class="badge">tu</span>' : ''}
      ${isHost && m.id !== S.you ? `<button type="button" class="xbtn" data-do="remove" data-id="${esc(m.id)}" aria-label="Rimuovi">✕</button>` : ''}</li>`).join('');
    const n = r.members.length, ready = n >= r.min;
    const need = Math.max(0, r.min - n);
    const status = ready
      ? (isHost ? 'Pronti: puoi avviare quando vuoi.' : 'In attesa che l\'host avvii la partita.')
      : `In attesa di giocatori: ne servono ancora ${need}.`;
    return `<section class="panel lobby-room">
        <p class="lobby-kicker">Lobby · attesa giocatori</p>
        <h2>Stanza <span class="code inline">${esc(r.code)}</span></h2>
        <p class="link">${esc(link)}</p>
        <div class="row"><button class="btn" type="button" data-do="copy">Copia link d'invito</button></div>
      </section>
      <section class="panel lobby-players">
        <h2>Giocatori ${n}/${r.max}</h2>
        <div class="lobby-meter" role="progressbar" aria-valuemin="0" aria-valuemax="${r.max}" aria-valuenow="${n}" aria-label="Posti occupati">
          <i data-n="${n}" data-max="${r.max}"></i>
          <span class="lobby-meter-mark" title="minimo ${r.min}"></span>
        </div>
        <p class="lobby-status${ready ? ' ready' : ''}">${esc(status)}</p>
        <ul class="members">${lis}</ul>
        ${isHost ? `<div class="row lobby-host">
            <button class="btn" type="button" data-do="addBot"${n >= r.max ? ' disabled' : ''}>Aggiungi un bot</button>
            <button class="btn primary" type="button" data-do="start"${!ready ? ' disabled' : ''}>Avvia la partita</button>
          </div>
          ${!ready ? `<p class="hint">Minimo ${r.min} posti: invita con il link oppure riempi con bot.</p>` : `<p class="hint">Puoi ancora aggiungere bot fino a ${r.max} giocatori.</p>`}`
          : `<p class="hint">Solo l'host può avviare. Ricarica se hai perso la connessione.</p>`}
      </section>`;
  }

  function gameHTML() {
    const v = V(), me = ME();
    const n = v.players.length;
    const others = Array.from({ length: n - 1 }, (_, i) => v.players[(me.seat + 1 + i) % n]);
    return `<div id="board">
      <div class="board-bar">
        <div class="piles" aria-label="Mazzi">
          <div class="pile t" title="Mazzo Ticket" aria-label="Mazzo Ticket: ${v.deck.T} carte"><b>${v.deck.T}</b></div>
          <div class="pile a" title="Mazzo Asset" aria-label="Mazzo Asset: ${v.deck.A} carte"><b>${v.deck.A}</b></div>
        </div>
        <span class="clock${(S.deadlineAt - Date.now()) < 15000 ? ' urgent' : ''}" data-cd="main" aria-label="Tempo rimasto">${mmss(S.deadlineAt - Date.now())}</span>
      </div>
      <section id="opps" aria-label="Avversari">${others.map(oppHTML).join('')}</section>
      <section id="table">${bubblesHTML()}${tableHTML()}</section>
      <section id="me" class="${v.cur === S.you && !v.over ? ' active' : ''}">${meHTML(me)}</section>
      <section id="log" class="${S.logOpen ? ' open' : ''}" role="button" tabindex="0" aria-expanded="${S.logOpen ? 'true' : 'false'}" title="Tocca per espandere">${(S.logOpen ? v.log.slice().reverse() : v.log.slice(-5).reverse()).map(r => `<div class="l ${esc(r.cls)}">${esc(r.t)}</div>`).join('')}</section>
      <nav id="actions">${actionsHTML()}</nav>
    </div>`;
  }
  function bubblesHTML() {
    const v = V(), log = v.log || [];
    const names = v.players.map(p => p.name).sort((a, b) => b.length - a.length);
    const items = [];
    log.forEach((r, i) => {
      if (r.cls !== 'quip') return;
      const prev = (log[i - 1] && log[i - 1].t) || '';
      const who = names.find(n => prev.startsWith(n)) || '';
      items.push({ who, t: String(r.t).replace(/^«\s*|\s*»$/g, '') });
    });
    const last = items.slice(-2);
    if (!last.length) return '';
    const me = ME();
    return `<div class="bubbles" aria-live="polite">${last.map(b => `<div class="bubble${b.who && me && b.who === me.name ? ' mine' : ''}">${b.who ? `<span class="bw">${esc(b.who)}</span>` : ''}${esc(b.t)}</div>`).join('')}</div>`;
  }

  function oppHTML(p) {
    const v = V(), c = v.combat, m = member(p.id);
    let st = '<span class="st"></span>';
    if (c) {
      if (p.id === c.fighter) st = `<span class="st fight">combatte${c.step === 'window' && passed(p.id) ? ' ✓' : ''}</span>`;
      else if (p.id === c.helper) st = `<span class="st help">aiuta${c.step === 'window' && passed(p.id) ? ' ✓' : ''}</span>`;
      else if (c.offer && c.offer.to === p.id) st = '<span class="st wait">valuta aiuto</span>';
      else if (c.step === 'window') st = passed(p.id) ? '<span class="st ok">passo</span>' : '<span class="st wait">decide</span>';
    } else if (v.cur === p.id && !v.over) st = '<span class="st wait">di turno</span>';
    const off = m && !m.connected, gear = p.gear || {};
    return `<div class="opp${v.cur === p.id && !v.over ? ' active' : ''}${off ? ' off' : ''}" data-pid="${esc(p.id)}">${st}
      <div class="on">${esc(p.name)}${p.isBot ? ' <span class="badge bot">bot</span>' : off ? ' <span class="badge off">offline</span>' : ''}</div>
      <div class="ol"><span class="lvl">${p.level}</span><span class="tt">${esc(p.title)}</span></div>
      <div class="ostats"><span><small>Forza</small><b>${p.power - p.penalty}</b></span><span><small>Carte</small><b>${p.handCount}</b></span><span><small>Esp.</small>${espPips(p)}</span></div>
      <div class="orole">${p.role ? esc(p.role.name) : 'nessun ruolo'}</div>
      <div class="minis">${p.role ? cardHTML(p.role, { mini: true }) : ''}${Object.keys(SLOTS).map(s => gear[s] ? cardHTML(gear[s], { mini: true }) : `<span class="oslot" title="${SLOTS[s]}: vuoto">${s.toUpperCase()}</span>`).join('')}</div></div>`;
  }

  function tableHTML() {
    const v = V(), c = v.combat, me = ME();
    if (c) {
      const f = P(c.fighter), h = c.helper ? P(c.helper) : null;
      const fdet = [`liv ${f.level}`, `asset +${sumGear(f)}`];
      if (c.fBonus) fdet.push(`bonus +${c.fBonus}`);
      if (f.penalty) fdet.push(`policy −${f.penalty}`);
      if (h) fdet.push(`${h.name} +${h.power}`);
      const mdet = c.threats.map(t => `${esc(t.card.name)}: ${t.eff}${t.mod ? (t.mod > 0 ? ' +' : ' ') + t.mod : ''}`);
      if (c.mBonus) mdet.push(`bonus +${c.mBonus}`);
      let status = '';
      if (c.step === 'prep') status = `${esc(f.name)} si prepara al combattimento · ${cd('main')}`;
      else if (c.step === 'window') {
        const waiting = v.players.filter(p => !passed(p.id)).map(p => p.name);
        status = `Finestra aperta · mancano: ${esc(waiting.join(', ') || 'nessuno')} · ${cd('main')}`;
      } else if (c.step === 'flee') status = `${esc(f.name)} deve tentare la fuga · ${cd('main')}`;
      if (c.offer) status += `<br>${esc(name(c.offer.from))} chiede aiuto a ${esc(name(c.offer.to))} per ${c.offer.share} ${pl(c.offer.share, 'tesoro', 'tesori')} · ${cd('offer')}`;
      return `<div class="fight">
        <div class="zone side f"><p class="zone-lab">Chi combatte</p><div class="lab">${esc(f.name)}${h ? ' + ' + esc(h.name) : ''}</div><div class="pow">${c.fighterPower}</div><div class="det">${fdet.map(esc).join('<br>')}</div></div>
        <div class="vs ${c.winning ? 'w' : 'l'}">${c.winning ? 'VINCE' : 'PERDE'}</div>
        <div class="zone side m"><p class="zone-lab">Minacce</p><div class="lab">${c.threats.length > 1 ? 'Minacce' : 'Minaccia'}</div><div class="pow">${c.threatPower}</div><div class="cardrow">${c.threats.map(t => cardHTML(t.card)).join('')}</div><div class="det">${mdet.join('<br>')}</div></div></div>
        <div class="stake">In palio: +${c.levels} ${pl(c.levels, 'livello', 'livelli')} · ${c.treasures} ${pl(c.treasures, 'tesoro', 'tesori')}${h ? ` (${c.share} a ${esc(h.name)})` : ''}</div>
        <div class="wstat">${status}</div>
        ${c.ev.length ? '<ul class="ev">' + c.ev.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul>' : ''}`;
    }
    let hint;
    if (v.over) hint = v.winner === S.you ? '<b>Hai ottenuto root. Hai vinto.</b> Ora la reperibilità è tua.' : `<b>${esc(name(v.winner))}</b> ha ottenuto root. Partita finita. Cambiate le password.`;
    else if (v.cur === me.id) {
      hint = {
        open: '<b>Il tuo turno.</b> Equipaggia, assumi un ruolo, usa i livelli: poi apri un ticket. Qualcuno deve pur farlo.',
        after: '<b>Ticket tranquillo.</b> Puoi cercare guai (tocca una Minaccia in mano), analizzare i log o chiudere il turno prima che arrivi altro.',
        end: '<b>Chiudi il turno</b> quando hai finito.'
      }[v.phase] || '';
      hint += ` <span class="hint">${cd('main')}</span>`;
    } else hint = `Turno di <b>${esc(name(v.cur))}</b>. Intanto puoi equipaggiarti, e le Sfighe puoi giocarle in qualsiasi momento.`;
    const rv = v.revealed ? `<div class="zone revealed"><p class="zone-lab">Ticket aperto</p>${cardHTML(v.revealed.card)}<div class="hintbig">da ${esc(name(v.revealed.by))}</div></div>` : '<div class="zone empty-zone"><p class="zone-lab">Ticket</p><p class="hint">Nessuna carta scoperta.</p></div>';
    return `<div class="hintbig">${hint}</div>${rv}`;
  }

  function meHTML(me) {
    const v = V();
    return `<div class="mehead">
        <div class="lvlbox"><div class="big">${me.level}</div><div class="tt">${esc(me.title)}</div></div>
        <div class="stats"><div>Forza <b>${me.power - me.penalty}</b>${me.penalty ? ` <span class="r">(policy −${me.penalty})</span>` : ''}</div>
        <div>Credito <b>${me.credit}</b>/1000</div><div>Esposizione ${espPips(me)}</div></div>
        <button type="button" class="rolechip" data-role="1">${me.role ? esc(me.role.name) + (me.blueReady ? ' · scudo' : '') : 'Nessun ruolo'}</button></div>
      <div class="slots">${Object.keys(SLOTS).map(s => { const g = me.gear[s]; return `<button type="button" class="slot${g ? ' full' : ''}" data-slot="${s}"><span class="sl">${SLOTS[s]}</span>${g ? `<img class="face mini" src="/cards/${artSlug(g)}.jpg" alt="">` + `<span class="sb">+${me.gearBonus[s]}</span>` : '<span class="sn empty">vuoto</span>'}</button>`; }).join('')}</div>
      <div class="handhead">La tua mano · <span class="${v.hand.length > v.handMax ? 'r' : ''}">${v.hand.length}/${v.handMax}</span>${v.hand.length > v.handMax ? ' · a fine turno scegli cosa scartare' : ''}</div>
      <div class="hand" data-hand-layout="${esc(store.get('esc-hand-layout') || 'fan')}" data-n="${v.hand.length}">${v.hand.map(c => cardHTML(c)).join('') || '<span class="hintbig">Mano vuota.</span>'}</div>`;
  }

  function actionsHTML() {
    const v = V(), c = v.combat, me = S.you, isHost = S.room.host === me;
    const B = (d, label, cls = '', dis = false) => `<button type="button" class="btn ${cls}" data-do="${d}"${dis ? ' disabled' : ''}>${esc(label)}</button>`;
    const H = t => `<span class="hint">${t}</span>`;
    if (v.over) return (isHost ? B('rematch', 'Rivincita', 'primary') : H('In attesa che l\'host proponga la rivincita.')) + B('leave', 'Esci', 'ghost');
    if (c) {
      if (c.offer && c.offer.to === me) return H(`${esc(name(c.offer.from))} ti chiede aiuto · ${cd('offer')}`);
      const fighter = c.fighter === me, canAsk = fighter && !c.helper && !c.offer;
      if (c.step === 'prep') {
        if (fighter) return H(`Prima di combattere puoi usare carte o chiedere aiuto. Poi si apre la finestra per gli altri. ${cd('main')}`) + (canAsk ? B('help', 'Chiedi aiuto') : '') + B('fight', 'Combatti', 'primary');
        return H(`${esc(name(c.fighter))} si prepara. Potrai interferire quando si apre la finestra.`);
      }
      if (c.step === 'window') {
        if (passed(me)) return H(`Hai passato. Ora guardi e basta, come in ogni post-mortem. Se qualcuno gioca una carta dovrai decidere di nuovo. ${cd('main')}`);
        if (canAutopass()) return H(`Non hai carte da combattimento: passo automatico tra pochi secondi. ${cd('main')}`) + B('pass', 'Passo ora', 'primary');
        const extra = fighter && c.offer && c.offer.from === me ? B('cancelHelp', 'Annulla richiesta', 'ghost') : canAsk ? B('help', 'Chiedi aiuto') : '';
        const label = fighter ? (c.winning ? 'Passo: chiudo e vinco' : 'Passo: vado alla fuga') : 'Passo';
        const tip = fighter ? (c.winning ? 'Sei in vantaggio. Gli altri possono ancora sabotarti finché non passano tutti.' : 'Sei in svantaggio: gioca carte o chiedi aiuto prima di passare.')
          : c.winning ? `${esc(name(c.fighter))} sta vincendo: tocca una carta per sabotare (+1 Esposizione) oppure passa.` : `${esc(name(c.fighter))} sta perdendo. Puoi passare, o aiutarlo con una carta.`;
        return H(`${tip} ${cd('main')}`) + extra + B('pass', label, 'primary');
      }
      if (c.step === 'flee' && fighter) return H(`Sei in svantaggio: tira il dado e spera che la VPN cada al momento giusto. Se hai un Rollback toccalo nella mano. ${cd('main')}`) + B('flee', 'Tenta la fuga', 'danger');
      return H(`${esc(name(c.fighter))} tenta la fuga…`);
    }
    if (v.cur === me) {
      if (v.phase === 'open') return B('open', 'Apri un ticket', 'primary');
      if (v.phase === 'after') return B('loot', 'Analizza i log') + B('endTurn', 'Fine turno', 'ghost');
      const ex = v.hand.length - v.handMax;
      return B('endTurn', ex > 0 ? `Fine turno (scarti ${ex})` : 'Fine turno', 'primary');
    }
    return H(`Turno di ${esc(name(v.cur))}…`);
  }

  /* ================= modali ================= */
  // S.modal = { title, html(), buttons(), dismiss, valid(), onBody(el) }
  function openModal(m) {
    if (!S.modal) S.focusEl = document.activeElement;
    S.modal = m; hidePeek(); renderModal();
    const first = $('#modal button'); if (first) first.focus();
  }
  function closeModal() {
    S.modal = null; const el = $('#modal'); el.classList.add('hidden'); el.innerHTML = ''; el._k = null;
    const back = S.focusEl; S.focusEl = null;
    if (back && typeof back.focus === 'function') try { back.focus(); } catch (e) { /* ignore */ }
  }
  function renderModal() {
    const m = S.modal, el = $('#modal');
    if (!m) return;
    const btns = m.buttons();
    m._btns = btns;
    paint(el, `<div class="mbox" role="dialog" aria-modal="true"><h3>${esc(typeof m.title === 'function' ? m.title() : m.title)}</h3><div class="mbody">${m.html()}</div>
      <div class="mbtns">${btns.map((b, i) => `<button type="button" class="btn ${b.cls || ''}" data-mi="${i}"${b.disabled ? ' disabled' : ''}>${esc(b.label)}</button>`).join('')}</div></div>`, '_k');
    el.classList.remove('hidden');
  }
  // Passo automatico: solo se non hai nulla da giocare nel combattimento, con ritardo casuale
  // così il tempo di risposta non rivela agli altri che sei senza carte.
  function canAutopass() {
    const v = V(), c = v && v.combat;
    if (!S.autopass || !c || c.step !== 'window' || passed(S.you) || c.fighter === S.you || c.helper === S.you || (c.offer && c.offer.to === S.you)) return false;
    return !v.hand.some(k => (k.type === 'oneshot' && !k.escape) || k.type === 'boost' || (k.type === 'lateral' && v.hand.some(t => t.type === 'threat')));
  }
  function scheduleAutopass() {
    const ok = canAutopass();
    const key = ok ? `${V().gid}|${V().version}` : null;
    if (key === S.apKey) return;
    clearTimeout(S.apTimer); S.apTimer = null; S.apKey = key;
    if (!ok) return;
    S.apTimer = setTimeout(() => { S.apTimer = null; if (canAutopass() && S.apKey === `${V().gid}|${V().version}`) act({ type: 'pass' }); }, 1500 + Math.random() * 2500);
  }
  function afterSync() {
    if (S.modal && S.modal.valid && !S.modal.valid()) closeModal();
    const v = V(); if (!v) return;
    scheduleAutopass();
    const c = v.combat;
    if (c && c.offer && c.offer.to === S.you) {
      const key = `${v.gid}|${c.offer.from}|${c.offer.share}|${c.asked.length}|${c.threats[0].card.uid}`;
      if (S.offerShown !== key) { S.offerShown = key; openOfferModal(); }
    }
  }

  function openSheet(uid, where) {
    const find = () => (where === 'hand' ? V().hand.find(c => c.uid === uid) : where === 'slot' ? Object.values(ME().gear).find(g => g && g.uid === uid) : where === 'role' ? ME().role : null);
    const card = () => (where === 'view' ? findPublic(uid) : find());
    openModal({
      dismiss: true,
      title: () => (card() || {}).name || '',
      valid: () => !!card(),
      html: () => cardDetail(card()),
      buttons: () => [...(where === 'view' ? [] : sheetButtons(find(), where)), { label: 'Chiudi', cls: 'ghost' }]
    });
  }
  function findPublic(uid) {
    const v = V();
    if (v.combat) for (const t of v.combat.threats) if (t.card.uid === uid) return t.card;
    if (v.revealed && v.revealed.card.uid === uid) return v.revealed.card;
    for (const p of v.players) { for (const g of Object.values(p.gear)) if (g && g.uid === uid) return g; if (p.role && p.role.uid === uid) return p.role; }
    return null;
  }
  function sheetButtons(card, where) {
    const v = V(), me = ME(), c = v.combat;
    if (!card || v.over) return [];
    const free = !c; // gestione: sempre, tranne durante un combattimento
    const myTurn = v.cur === S.you && !c;
    const inFight = !!c && ((c.step === 'prep' && (c.fighter === S.you || c.helper === S.you)) || c.step === 'window');
    const mine = c && (c.fighter === S.you || c.helper === S.you);
    const B = [];
    const go = a => () => act(a);
    if (where === 'slot') {
      if (free) B.push({ label: `Vendi per ${card.value} di credito`, on: go({ type: 'sell', card: card.uid }) }, { label: 'Rimetti in mano', on: go({ type: 'unequip', slot: card.slot }) });
      return B;
    }
    if (where === 'role') { if (free) B.push({ label: 'Abbandona il ruolo', cls: 'ghost', on: go({ type: 'dropRole' }) }); return B; }
    switch (card.type) {
      case 'gear':
        if (free) {
          const eq = me.gear[card.slot];
          B.push({ label: eq ? `Equipaggia (torna in mano ${eq.name})` : 'Equipaggia', cls: 'primary', on: go({ type: 'equip', card: card.uid }) });
          B.push({ label: `Vendi per ${card.value} di credito`, on: go({ type: 'sell', card: card.uid }) });
        }
        break;
      case 'oneshot':
        if (card.escape) { if (c && c.step === 'flee' && c.fighter === S.you) B.push({ label: 'Usa: ti sganci senza tirare il dado', cls: 'primary', on: go({ type: 'rollback', card: card.uid }) }); }
        else if (inFight) {
          B.push({ label: mine ? `Bonus al tuo lato (+${card.bonus})` : `Aiuta ${name(c.fighter)} (+${card.bonus})`, cls: mine ? 'primary' : '', on: go({ type: 'play', card: card.uid, side: 'f' }) });
          B.push({ label: `Potenzia la minaccia (+${card.bonus})${mine ? '' : ' · sabotaggio'}`, cls: mine ? '' : 'danger', on: go({ type: 'play', card: card.uid, side: 'm' }) });
        }
        if (free) B.push({ label: `Vendi per ${card.value} di credito`, on: go({ type: 'sell', card: card.uid }) });
        break;
      case 'levelup':
        if (free) B.push(me.level < 9 ? { label: 'Usa: +1 livello', cls: 'primary', on: go({ type: 'levelUp', card: card.uid }) } : { label: 'Non utilizzabile a livello 9', disabled: true });
        break;
      case 'role':
        if (free) B.push({ label: me.role ? `Assumi (lasci ${me.role.name})` : 'Assumi il ruolo', cls: 'primary', on: go({ type: 'takeRole', card: card.uid }) });
        break;
      case 'curse':
        v.players.filter(p => p.id !== S.you).forEach(p => B.push({ label: `Gioca su ${p.name} (liv ${p.level}) · sabotaggio`, cls: 'danger', on: go({ type: 'curse', card: card.uid, target: p.id }) }));
        break;
      case 'threat':
        if (myTurn && v.phase === 'after') B.push({ label: 'Cerca guai: affrontala ora', cls: 'primary', on: go({ type: 'trouble', card: card.uid }) });
        break;
      case 'boost':
        if (inFight) { const sab = card.amt > 0 && !mine; B.push({ label: `Gioca sulla minaccia (${card.amt > 0 ? '+' : ''}${card.amt})${sab ? ' · sabotaggio' : ''}`, cls: sab ? 'danger' : 'primary', on: go({ type: 'play', card: card.uid }) }); }
        break;
      case 'lateral':
        if (inFight) v.hand.filter(x => x.type === 'threat').forEach(th => B.push({ label: `Aggiungi ${th.name} (forza ${th.l})${mine ? '' : ' · sabotaggio'}`, cls: mine ? '' : 'danger', on: go({ type: 'play', card: card.uid, threat: th.uid }) }));
        break;
    }
    if (free && !['gear', 'oneshot'].includes(card.type)) B.push({ label: 'Scarta', cls: 'ghost', on: go({ type: 'discard', card: card.uid }) });
    return B;
  }

  function openHelpModal() {
    const st = { share: Math.floor((V().combat ? V().combat.treasures : 0) / 2) };
    openModal({
      dismiss: true, title: 'Chiedi aiuto',
      valid: () => { const c = V() && V().combat; return !!(c && c.fighter === S.you && !c.helper && !c.offer); },
      html: () => {
        const c = V().combat;
        return `<p>Chi accetta somma la sua forza alla tua e pesca per primo i tesori che gli offri. Non guadagna livelli. Una richiesta alla volta.</p>
          <p>Tesori in palio: <b>${c.treasures}</b>. Ne offri:</p>
          <div class="stepper"><button type="button" data-m="minus" aria-label="Meno">−</button><b>${st.share}</b><button type="button" data-m="plus" aria-label="Più">+</button></div>`;
      },
      onBody: el => { const c = V().combat; if (el.dataset.m === 'minus') st.share = Math.max(0, st.share - 1); if (el.dataset.m === 'plus') st.share = Math.min(c.treasures, st.share + 1); },
      buttons: () => {
        const c = V().combat;
        return [...V().players.filter(p => p.id !== S.you).map(p => {
          const fp = c.fighterPower + p.power, ok = fp > c.threatPower || (fp === c.threatPower && ME().role && ME().role.role === 'red');
          return { label: `${p.name} (forza ${p.power})${ok ? '' : ' · non basterebbe'}${c.asked.includes(p.id) ? ' · già chiesto' : ''}`, cls: ok ? 'primary' : '', on: () => act({ type: 'askHelp', to: p.id, share: st.share }) };
        }), { label: 'Annulla', cls: 'ghost' }];
      }
    });
  }

  function openOfferModal() {
    openModal({
      title: 'Richiesta di aiuto',
      valid: () => { const c = V() && V().combat; return !!(c && c.offer && c.offer.to === S.you); },
      html: () => {
        const c = V().combat, f = P(c.fighter), with_ = c.fighterPower + ME().power;
        const names = c.threats.map(t => t.card.name).join(' + ');
        return `<p><b>${esc(f.name)}</b> ti chiede aiuto contro <b>${esc(names)}</b>.</p>
          <p>Da solo: ${c.fighterPower} contro ${c.threatPower}. Con te: ${with_}.</p>
          <p>Ti offre <b>${c.offer.share}</b> ${pl(c.offer.share, 'tesoro', 'tesori')} su ${c.treasures}. Tu non guadagni livelli.</p>
          ${f.level + c.levels >= 10 ? '<p class="warn">Se vince, vince la partita.</p>' : ''}
          <p class="hint">Rispondi entro ${cd('offer')}</p>`;
      },
      buttons: () => [{ label: 'Accetta', cls: 'primary', on: () => act({ type: 'answerHelp', accept: true }) }, { label: 'Rifiuta', cls: 'ghost', on: () => act({ type: 'answerHelp', accept: false }) }]
    });
  }

  function openDiscardModal() {
    const st = { sel: new Set() };
    openModal({
      dismiss: true, title: 'Limite di mano',
      valid: () => { const v = V(); return !!(v && v.cur === S.you && !v.combat && v.hand.length > v.handMax); },
      html: () => {
        const v = V(), ex = v.hand.length - v.handMax;
        return `<p>Hai ${v.hand.length} carte: scegline <b>${ex}</b> da scartare.</p><div class="cardrow">${v.hand.map(c => cardHTML(c, { sel: st.sel.has(c.uid), m: 'pick' })).join('')}</div>`;
      },
      onBody: el => { const uid = +el.dataset.uid; if (st.sel.has(uid)) st.sel.delete(uid); else st.sel.add(uid); },
      buttons: () => {
        const v = V(), ex = v.hand.length - v.handMax;
        return [{ label: `Scarta e chiudi il turno (${st.sel.size}/${ex})`, cls: 'primary', disabled: st.sel.size !== ex, on: () => act({ type: 'endTurn', discard: [...st.sel] }) }, { label: 'Annulla', cls: 'ghost' }];
      }
    });
  }

  function openOppModal(pid) {
    openModal({
      dismiss: true, title: () => name(pid), valid: () => !!(V() && P(pid)),
      html: () => {
        const p = P(pid), gs = Object.entries(p.gear).filter(([, g]) => g);
        return `<p>Livello ${p.level} (${esc(p.title)}) · forza ${p.power} · esposizione ${p.esp}/${V().espMax} · credito ${p.credit}</p>
          <p>Ruolo: ${p.role ? esc(p.role.name) + ' — ' + esc((ROLES[p.role.role] || { text: '' }).text) : 'nessuno'}</p>
          <p>Asset equipaggiati:</p><ul class="gearlist">${gs.length ? gs.map(([s, g]) => `<li>${esc(g.name)} (+${p.gearBonus[s]}, ${SLOTS[s]})</li>`).join('') : '<li>nessuno</li>'}</ul>
          <p>Carte in mano: ${p.handCount}</p>`;
      },
      buttons: () => [{ label: 'Chiudi', cls: 'primary' }]
    });
  }

  const WIKI = { threat: 'Minacce', curse: 'Sfighe', boost: 'Interferenze', lateral: 'Interferenze', role: 'Ruoli', gear: 'Asset', oneshot: 'Uso singolo', levelup: 'Livello' };
  function loadCatalog() {
    if (S.catalog) return;
    S.catalog = [];
    fetch('/catalog.json').then(r => r.json()).then(c => { S.catalog = c; renderModal(); })
      .catch(() => { S.catalog = null; toast('Catalogo carte non disponibile, riprova.'); });
  }
  function wikiHTML(st) {
    const all = S.catalog || [], c = all[st.sel];
    if (!all.length) return '<p>Caricamento del catalogo…</p>';
    if (c) return `<button type="button" class="btn" data-m="back">← Tutte le carte</button>
      <h4>${esc(c.name)}</h4><p class="kind">mazzo ${c.deck === 'T' ? 'Ticket' : 'Asset'} · ${c.n} ${pl(c.n, 'copia', 'copie')}</p>${cardDetail(c)}`;
    return `<div class="wiki-f">${[...new Set(Object.values(WIKI))].map(g => `<button type="button" class="btn${g === st.f ? ' primary' : ''}" data-m="f:${g}" aria-pressed="${g === st.f}">${g}</button>`).join('')}</div>
      <div class="wiki">${all.map((x, i) => WIKI[x.type] !== st.f ? '' : `<button type="button" class="wiki-i" data-m="c:${i}"><img src="/cards/${artSlug(x)}.jpg" alt="" loading="lazy"><span>${esc(x.name)}</span><small>×${x.n}</small></button>`).join('')}</div>`;
  }
  function openRules() {
    const st = S.rulesUi || (S.rulesUi = { tab: 'rules', f: 'Minacce', sel: -1 });
    if (st.tab === 'wiki') loadCatalog();
    openModal({
      dismiss: true, title: 'Regole di ESCALATION',
      onBody: el => {
        const [k, v] = el.dataset.m.split(':');
        if (k === 'tab') { st.tab = v; if (v === 'wiki') loadCatalog(); }
        if (k === 'f') st.f = v;
        st.sel = k === 'c' ? +v : -1;
      },
      buttons: () => {
        const layout = store.get('esc-hand-layout') || 'row';
        return [
          { label: `Passo automatico senza carte da combattimento: ${S.autopass ? 'attivo' : 'disattivo'}`, on: () => { S.autopass = !S.autopass; store.set('esc-autopass', S.autopass); scheduleAutopass(); toast(`Passo automatico ${S.autopass ? 'attivato' : 'disattivato'}.`); openRules(); } },
          { label: `Layout mano: ${layout === 'fan' ? 'ventaglio (hook)' : 'fila'} — tocca per cambiare`, on: () => { const next = layout === 'fan' ? 'row' : 'fan'; store.set('esc-hand-layout', next); toast(`Mano: ${next === 'fan' ? 'ventaglio (struttura pronta, tema dopo)' : 'fila'}.`); render(); openRules(); } },
          { label: 'Chiudi', cls: 'primary' }
        ];
      },
      html: () => `<div class="tabs" role="tablist">${[['rules', 'Come si gioca'], ['wiki', 'Wiki carte']].map(([k, l]) => `<button type="button" role="tab" class="btn${st.tab === k ? ' primary' : ''}" data-m="tab:${k}" aria-selected="${st.tab === k}">${l}</button>`).join('')}</div>
        <div class="rules">${st.tab === 'wiki' ? wikiHTML(st) : `
        <h4>Obiettivo</h4><p>Arrivare per primi al livello 10, <b>root</b>. L'ultimo livello si ottiene solo neutralizzando una Minaccia: carte livello e credito si fermano al 9.</p>
        <h4>Le carte</h4><ul>
        <li><b>Mazzo Ticket</b>: Minacce da combattere, Sfighe da giocare sugli altri, Ruoli, Interferenze che potenziano o indeboliscono un combattimento.</li>
        <li><b>Mazzo Asset</b>: equipaggiamento per i 4 slot, carte a uso singolo e carte livello.</li></ul>
        <p>Cosa fa ogni carta, con forza, effetti e numero di copie: scheda <b>Wiki carte</b> qui sopra.</p>
        <h4>Il tuo turno</h4><ul>
        <li><b>Apri un ticket</b>: carta scoperta. Minaccia: combatti. Sfiga: la subisci. Altro: va in mano.</li>
        <li>Se non hai combattuto: <b>cerca guai</b> (affronti una Minaccia dalla mano) o <b>analizza i log</b> (peschi una carta coperta).</li>
        <li><b>Fine turno</b>: massimo 5 carte in mano, scegli tu cosa scartare.</li></ul>
        <h4>Combattimento</h4><p>Forza = livello + asset + carte a uso singolo. Chi combatte si prepara, poi si apre la <b>finestra di interferenza</b>: tutti, compreso chi combatte, devono dichiarare «passo». Ogni carta giocata riapre il giro dei passo. Quando tutti hanno passato: se sei in vantaggio vinci livelli e tesori, altrimenti tiri il dado per fuggire (5+, Sysadmin 4+).</p>
        <h4>Aiuto</h4><p>Chi combatte può chiedere aiuto a un avversario offrendo una parte dei tesori. L'aiutante somma la sua forza, pesca per primo la sua parte e non guadagna livelli.</p>
        <h4>Sabotaggi ed Esposizione</h4><p>Potenziare la Minaccia di un altro, aggiungerne una con Movimento laterale o giocare una Sfiga su qualcuno (in qualsiasi momento) è un <b>sabotaggio</b>: +1 Esposizione. A 4 scatta l'<b>audit del SOC</b>: −1 livello e si riparte da zero. L'Ingegnere sociale non lascia tracce.</p>
        <h4>Asset e credito</h4><p>Uno slot per tipo: Hardware, Software, Credenziali, Gadget. Puoi equipaggiarti, cambiare ruolo e vendere in qualsiasi momento, ma mai durante un combattimento. Vendendo asset accumuli credito: ogni 1000 è +1 livello.</p>
        <h4>Ruoli</h4><ul>${Object.values(ROLES).map(r => `<li><b>${r.name}</b>: ${r.text}</li>`).join('')}</ul>
        <h4>Tempi e disconnessioni</h4><p>Ogni decisione ha un tempo massimo: allo scadere il server passa, chiude il turno o tira la fuga al posto tuo. Se perdi la connessione hai 15 secondi per rientrare, poi le tue mosse diventano automatiche finché non torni.</p>`}</div>`
    });
  }

  /* ================= anteprima al passaggio del mouse ================= */
  const peek = document.createElement('div');
  peek.id = 'peek'; peek.className = 'hidden'; peek.setAttribute('aria-hidden', 'true');
  document.body.appendChild(peek);
  const hidePeek = () => { peek.classList.add('hidden'); peek._uid = null; };
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.addEventListener('mouseover', e => {
      const el = !S.modal && S.view && e.target.closest('.card[data-uid], .slot.full');
      const c = el && (el.dataset.uid ? (V().hand.find(x => x.uid === +el.dataset.uid) || findPublic(+el.dataset.uid)) : ME().gear[el.dataset.slot]);
      if (!c) return hidePeek();
      if (peek._uid === c.uid) return;
      peek._uid = c.uid;
      peek.innerHTML = `<img src="/cards/${artSlug(c)}.jpg" alt=""><div><b>${esc(c.name)}</b>${fxHTML(c)}</div>`;
      peek.classList.remove('hidden');
      const r = el.getBoundingClientRect(), w = peek.offsetWidth, h = peek.offsetHeight;
      const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
      const y = r.top - h - 14 > 8 ? r.top - h - 14 : Math.min(r.bottom + 14, innerHeight - h - 8);
      peek.style.left = x + 'px'; peek.style.top = y + 'px';
    });
  }

  /* ================= eventi ================= */
  document.addEventListener('input', e => {
    const f = e.target.dataset && e.target.dataset.f;
    if (!f) return;
    S.form[f] = f === 'code' ? e.target.value.toUpperCase() : e.target.value;
    if (f === 'name') store.set('esc-name', e.target.value);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && S.modal && S.modal.dismiss) { closeModal(); return; }
    if (e.key === 'Enter' || e.key === ' ') {
      if (e.target && e.target.id === 'log') { e.preventDefault(); S.logOpen = !S.logOpen; render(); return; }
    }
    if (e.key !== 'Enter' || !e.target.dataset || !e.target.dataset.f) return;
    doAction(e.target.dataset.f === 'code' ? 'join' : 'create');
  });

  document.addEventListener('click', e => {
    const modalEl = $('#modal');
    if (S.modal) {
      const mb = e.target.closest('[data-mi]');
      if (mb && !mb.disabled) {
        const b = S.modal._btns[+mb.dataset.mi];
        closeModal();
        if (b && b.on) b.on();
        return;
      }
      const body = e.target.closest('.mbody [data-m]');
      if (body && S.modal.onBody) { S.modal.onBody(body); renderModal(); return; }
      if (e.target === modalEl && S.modal.dismiss) closeModal();
      return;
    }
    const d = e.target.closest('[data-do]');
    if (d && !d.disabled) return doAction(d.dataset.do, d);
    if (!S.view || !S.room || !S.room.started) return;
    const card = e.target.closest('.card[data-uid]');
    if (card) {
      const uid = +card.dataset.uid;
      return openSheet(uid, V().hand.some(c => c.uid === uid) ? 'hand' : 'view');
    }
    const slot = e.target.closest('.slot[data-slot]');
    if (slot) { const g = ME().gear[slot.dataset.slot]; if (g) openSheet(g.uid, 'slot'); return; }
    if (e.target.closest('[data-role]')) { if (ME().role) openSheet(ME().role.uid, 'role'); return; }
    const opp = e.target.closest('.opp[data-pid]');
    if (opp) return openOppModal(opp.dataset.pid);
    if (e.target.closest('#log')) { S.logOpen = !S.logOpen; render(); }
  });

  function doAction(d, el) {
    switch (d) {
      case 'create': if (!S.form.name.trim()) return toast('Scrivi il tuo nome.', 'warn'); return send({ t: 'create', name: S.form.name });
      case 'join':
        if (!S.form.name.trim()) return toast('Scrivi il tuo nome.', 'warn');
        if (S.form.code.trim().length < 5) return toast('Il codice stanza ha 5 caratteri.', 'warn');
        return send({ t: 'join', code: S.form.code, name: S.form.name });
      case 'copy': {
        const link = location.origin + '/?r=' + S.room.code;
        if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => toast('Link copiato.', 'good'), () => toast(link));
        else toast(link, '', 10000);
        return;
      }
      case 'addBot': return send({ t: 'addBot' });
      case 'remove': return send({ t: 'removeMember', id: el.dataset.id });
      case 'start': return send({ t: 'start' });
      case 'rematch': return send({ t: 'rematch' });
      case 'leave': return askLeave();
      case 'open': return act({ type: 'openTicket' });
      case 'loot': return act({ type: 'loot' });
      case 'endTurn': {
        const v = V();
        if (v.hand.length > v.handMax) return openDiscardModal();
        return act({ type: 'endTurn', discard: [] });
      }
      case 'fight': return act({ type: 'fight' });
      case 'pass': return act({ type: 'pass' });
      case 'help': return openHelpModal();
      case 'cancelHelp': return act({ type: 'cancelHelp' });
      case 'flee': return act({ type: 'flee' });
    }
  }
  function askLeave() {
    const inGame = S.room && S.room.started && S.view && !S.view.over;
    openModal({
      dismiss: true, title: 'Uscire dalla stanza?',
      html: () => `<p>${inGame ? 'La partita continua senza di te: da ora in poi il server passa e chiude i tuoi turni in automatico. Non potrai rientrare.' : 'Potrai rientrare con il codice finché la partita non inizia.'}</p>`,
      buttons: () => [{ label: 'Esci', cls: 'danger', on: () => { send({ t: 'leave' }); } }, { label: 'Resta', cls: 'ghost' }]
    });
  }
  $('#bRules').addEventListener('click', e => { e.stopPropagation(); openRules(); });
  $('#bLeave').addEventListener('click', e => { e.stopPropagation(); askLeave(); });

  // countdown
  setInterval(() => {
    document.querySelectorAll('[data-cd]').forEach(el => {
      const left = (el.dataset.cd === 'offer' ? S.offerAt : S.deadlineAt) - Date.now();
      el.textContent = mmss(left);
      if (el.classList.contains('clock')) el.classList.toggle('urgent', left < 15000);
    });
  }, 1000);

  render();
  connect();
})();
