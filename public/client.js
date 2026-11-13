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
    sys: { name: 'Sysadmin', text: 'La fuga riesce con 3 o più invece che con 5.' },
    blue: { name: 'Blue Teamer', text: 'La prima Sfiga che un avversario ti gioca in ogni giro viene bloccata.' },
    social: { name: 'Ingegnere sociale', text: 'I tuoi sabotaggi non aumentano l\'Esposizione.' }
  };
  const params = new URLSearchParams(location.search);
  const S = {
    ws: null, online: false, retry: 0, stop: false, connecting: false, retryTimer: null, actPending: false, focusEl: null,
    session: store.get('esc-session'), you: null, room: null, view: null,
    gid: null, lastFx: 0, deadlineAt: 0, offerAt: 0, logOpen: false, modal: null, offerShown: null,
    autopass: store.get('esc-autopass') !== false, apTimer: null, apKey: null,
    seen: new Set(), shownUid: null,
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
        S.room = m.room; S.you = m.room.you; S.view = m.view; S.tut = m.tut || null;
        if (m.view) {
          const fresh = S.gid !== m.view.gid;
          if (fresh) { S.seen = new Set(m.view.hand.map(c => c.uid)); S.shownUid = m.view.revealed ? m.view.revealed.card.uid : null; }
          S.gid = m.view.gid;
          S.deadlineAt = m.view.deadlineIn != null ? Date.now() + m.view.deadlineIn : 0;
          S.offerAt = m.view.offerIn != null ? Date.now() + m.view.offerIn : 0;
          handleFx(m.view.fx, fresh);
          if (fresh && m.view.turn === 1 && !m.view.over) {
            if (store.get('esc-tut-off')) send({ t: 'tutDone' });
            else openTut();
          }
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
    while (box.children.length > 2) box.lastChild.remove();
    setTimeout(() => el.remove(), ms);
  }
  function handleFx(list, fresh) {
    const maxI = list.reduce((m, e) => Math.max(m, e.i), 0);
    if (fresh) { S.lastFx = maxI; return; }
    for (const e of list) if (e.i > S.lastFx) fxToast(e);
    S.lastFx = Math.max(S.lastFx, maxI);
  }
  function fxToast(e) {
    const me = S.you, q = e.quip ? ' «' + e.quip + '»' : '';
    switch (e.kind) {
      case 'roll': splashRoll(e); break;
      // Finestra, passo e richieste tra altri si leggono già su tavolo, badge e registro:
      // gli avvisi restano per ciò che ti riguarda di persona, così non coprono gli avversari.
      case 'sabotage': if (e.target === me) toast(`Sabotaggio: ${e.text}.${q}`, 'bad', 7000); break;
      case 'helpNo': if (e.to === me) toast(`${name(e.by)} rifiuta.${q}`, 'warn'); break;
      case 'curse':
        if (e.target === me) toast(`${name(e.by)} ti gioca «${e.card}»: ${e.text}. «${e.d || ''}»`, 'bad', 8000);
        break;
      case 'audit': toast(e.pid === me ? `Audit del SOC: troppe tracce, perdi 1 livello.${q}` : `Audit del SOC su ${name(e.pid)}.${q}`, e.pid === me ? 'bad' : 'warn', 7000); break;
      case 'win': if (e.pid === me) toast(`Minaccia neutralizzata: sei a livello ${e.level}.${q}`, 'good', 7000); break;
      case 'kept': toast(`Va in mano: ${e.card}.`, 'good', 5000); break;
      case 'skip': toast(e.pid === me ? `Salti questo turno.${q}` : `${name(e.pid)} salta il turno.${q}`, e.pid === me ? 'bad' : 'warn', 6000); break;
      case 'bounce':
        if (e.target === me) toast(`${name(e.by)} è fuori ufficio: «${e.card}» torna a te. ${e.text}.${q}`, 'bad', 8000);
        else if (e.by === me) toast(`Risposta automatica: «${e.card}» torna a ${name(e.target)}.`, 'good', 6000);
        break;
      case 'freeze': toast(`${e.by === me ? 'Hai dichiarato' : name(e.by) + ' dichiara'} il Change freeze: ora si può solo passare.${q}`, 'warn', 7000); break;
      case 'honeypot': if (e.target === me) toast(`Honeypot di ${name(e.by)}: il tuo «${e.card}» è annullato e prendi +1 Esposizione.${q}`, 'bad', 8000); break;
      case 'oncall': if (e.target === me) toast(`${name(e.by)} ti mette di reperibilità: lo aiuti gratis.${q}`, 'warn', 8000); break;
      case 'scapegoat': if (e.target === me) toast(`${name(e.by)} ti indica come capro espiatorio: se lo prendono, paghi tu.`, 'bad', 8000); break;
      case 'reassign': if (e.target === me) toast(`${name(e.by)} ti riassegna il ticket: ora combatti tu contro ${e.threat}.`, 'bad', 9000); break;
      case 'falsepos': if (e.target === me && e.by !== me) toast(`${name(e.by)}: Falso positivo. Combattimento annullato.${q}`, 'warn', 7000); break;
      case 'swap': if (e.a === me || e.b === me) toast(`Scambio di mano con ${name(e.a === me ? e.b : e.a)}: guarda cosa ti è arrivato.`, 'warn', 8000); break;
      case 'drawn': toast(`Peschi: ${e.cards.join(', ')}.`, 'good', 6000); break;
      case 'gameover': toast(`${e.winner === me ? 'Hai ottenuto root. Hai vinto.' : name(e.winner) + ' ha ottenuto root.'}${q}`, e.winner === me ? 'good' : 'warn', 10000); break;
    }
  }

  // Il tiro di fuga si vede: un dado al centro del tavolo, con soglia ed esito.
  function splashRoll(e) {
    const mine = e.pid === S.you;
    const el = document.createElement('div');
    el.className = 'splash ' + (e.ok ? 'good' : 'bad');
    el.setAttribute('role', 'status');
    el.innerHTML = `<p class="splash-k">${mine ? 'Tenti la fuga' : esc(name(e.pid)) + ' tenta la fuga'} da ${esc(e.threat)}</p>
      <div class="splash-roll"><span class="die" data-v="${+e.roll}" aria-label="Dado: ${+e.roll}">${'<i></i>'.repeat(9)}</span><span class="need">serve ${+e.need}+</span></div>
      <p class="splash-r">${e.ok ? (mine ? 'Ti disconnetti in tempo.' : 'Scappa.') : e.victim ? `Preso, ma paga ${esc(e.victim === S.you ? 'il capro espiatorio: tu' : name(e.victim))}: ${esc(e.bad)}.` : (mine ? 'Ti prende: ' : 'Preso: ') + esc(e.bad) + '.'}</p>${e.quip ? `<p class="splash-q">«${esc(e.quip)}»</p>` : ''}`;
    document.querySelectorAll('.splash').forEach(x => x.remove());
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  /* ================= carte ================= */
  // Il testo delle penalità lo scrive il server (server/cards.js) e ogni carta lo porta in `bt`.
  const badText = c => c.bt || '';
  // Illustrazione ritagliata sulla propria cornice: le percentuali arrivano da /cards.css (art/build-frames.py).
  const faceHTML = (c, cls = '') => { const a = artSlug(c); return `<span class="face${cls ? ' ' + cls : ''}" data-art="${a}"><img src="/cards/${a}.jpg" alt="" decoding="async" draggable="false"></span>`; };
  const backHTML = k => `<span class="face" data-art="back-${k}"><img src="/board/back-${k}.jpg" alt="" draggable="false"></span>`;
  function cardHTML(c, opt = {}) {
    const cls = ['card', 'k-' + c.type, c.type === 'trick' && 'k-trick-' + c.deck, opt.lg && 'lg', opt.mini && 'mini', opt.sel && 'sel', opt.can && 'can', opt.fresh && 'in'].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" data-uid="${c.uid}"${opt.m ? ` data-m="${opt.m}"` : ''} aria-label="${esc(c.name)}">${faceHTML(c)}${cardTag(c) ? `<span class="tag">${cardTag(c)}</span>` : ''}</button>`;
  }
  // Iniziali per il badge: due parole, altrimenti le prime due lettere.
  function ini(n) {
    const w = String(n || '').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    return ((w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)) || '?').toUpperCase();
  }
  const avaHTML = p => `<span class="ava" data-seat="${p.seat}" aria-hidden="true">${esc(ini(p.name))}</span>`;
  function artSlug(c) {
    const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
    if (c.type === 'levelup') return 'level-' + slug(c.name);
    if (c.type === 'role') return 'role-' + (c.role || slug(c.name));
    if (c.type === 'gear') return 'gear-' + (c.slot || 'x') + '-' + slug(c.name);
    if (c.type === 'lateral') return 'lateral-movimento';
    return (c.type || 'card') + '-' + slug(c.name);
  }
  const KIND = { threat: 'Minaccia', curse: 'Sfiga', boost: 'Interferenza', lateral: 'Interferenza', role: 'Ruolo', gear: 'Asset', oneshot: 'Uso singolo', levelup: 'Carta livello' };
  // Le carte speciali stanno in tutti e due i mazzi: nel Ticket sono Interferenze, nell'Asset carte a uso singolo.
  const kindOf = c => (c.type === 'trick' ? (c.deck === 'T' ? 'Interferenza' : 'Uso singolo') : KIND[c.type] || '');
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
        bad = `Se non scappi: ${badText(c)}`;
        if (c.vs) R.push(`+${c.vs.n} contro ${(ROLES[c.vs.role] || { name: c.vs.role }).name}`);
        if (c.flee > 0) R.push(`Più facile da cui fuggire (+${c.flee} al dado)`);
        if (c.flee < 0) R.push(`Più difficile da cui fuggire (${c.flee} al dado)`);
        break;
      case 'curse': R.push(`Chi la subisce: ${badText(c)}`, 'Giocabile su chiunque, in qualsiasi momento. Ti costa 1 punto di Esposizione.'); break;
      case 'role': R.push((ROLES[c.role] || { text: '' }).text, 'Un solo ruolo alla volta.'); break;
      case 'boost': R.push(`${c.amt > 0 ? '+' : ''}${c.amt} alla minaccia, ${c.tr > 0 ? '+' : ''}${c.tr} ${pl(Math.abs(c.tr), 'tesoro', 'tesori')}${c.lv ? `, +${c.lv} ${pl(c.lv, 'livello', 'livelli')} a chi la batte` : ''}`, c.amt > 0 ? 'Sul combattimento di un altro è un sabotaggio: +1 Esposizione.' : 'Indebolisce la minaccia: nessuna Esposizione.'); break;
      case 'lateral': R.push('Durante un combattimento aggiunge una Minaccia dalla tua mano.', 'Sul combattimento di un altro è un sabotaggio: +1 Esposizione.'); break;
      case 'gear': R.push(`Slot ${SLOTS[c.slot]} · +${c.bonus} · valore ${c.value}`); if (c.roleBonus) R.push(`+${c.roleBonus.n} extra per ${(ROLES[c.roleBonus.role] || { name: c.roleBonus.role }).name}`); break;
      case 'oneshot': R.push(c.escape ? 'Quando devi fuggire: ti sganci senza tirare il dado.' : `+${c.bonus} a una delle due parti di un combattimento qualsiasi.`, `Valore ${c.value}`); break;
      case 'levelup': R.push('+1 livello in qualsiasi momento, fuori dal combattimento. Non porta a 10.'); break;
      case 'trick': R.push(c.text || ''); if (c.value) R.push(`Valore ${c.value}`); break;
    }
    return `<p class="kind">${kindOf(c)}</p><ul class="fx">${R.map(r => `<li>${esc(r)}</li>`).join('')}</ul>${bad ? `<p class="pen">${esc(bad)}</p>` : ''}${c.d && c.type !== 'role' ? `<p class="flav">«${esc(c.d)}»</p>` : ''}`;
  }
  function cardDetail(c) {
    if (!c) return '';
    return `<div class="detail">${faceHTML(c, 'zoom')}<div class="detail-t">${fxHTML(c)}</div></div>`;
  }
  const espPips = p => `<span class="esp${p.esp >= V().espMax - 1 ? ' w3' : ''}" title="Esposizione ${p.esp}/${V().espMax}">${Array.from({ length: V().espMax }, (_, i) => `<i class="${i < p.esp ? 'on' : ''}"></i>`).join('')}</span>`;
  const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const cd = kind => `<span class="cd" data-cd="${kind}">${mmss((kind === 'offer' ? S.offerAt : S.deadlineAt) - Date.now())}</span>`;
  // Confronto senza i countdown: se il contenuto non cambia non si tocca il DOM (niente tap persi).
  const stable = html => html
    .replace(/<span class="(?:cd|hud-cd)" data-cd="(\w+)">[^<]*<\/span>/g, '[$1]');
  function paint(el, html, key) {
    const k = stable(html);
    if (el[key] === k) return false;
    el[key] = k; el.innerHTML = html; return true;
  }

  /* ================= schermate ================= */
  // La partita ha uno scheletro fisso; ogni zona si ridisegna solo se il suo contenuto cambia,
  // così una mossa altrui non tocca la tua mano sotto il dito.
  const SKELETON = `<div id="board">
      <div id="stage">
        <section id="opps" aria-label="Avversari"></section>
        <section id="table"><div id="piles" aria-label="Mazzi"></div><div id="arena"></div></section>
        <section id="me" aria-label="La tua postazione"></section>
        <aside id="log" role="button" tabindex="0" aria-label="Registro della partita"></aside>
      </div>
      <section id="handwrap" aria-label="La tua mano"></section>
      <nav id="actions" aria-label="Azioni"></nav>
    </div>`;
  function render() {
    const net = $('#netdot');
    net.className = 'dot' + (S.online ? ' on' : '');
    net.setAttribute('aria-label', S.online ? 'Online' : 'Offline');
    $('#bLeave').classList.toggle('hidden', !S.room);
    const ingame = !!(S.room && S.room.started && S.view);
    document.body.classList.toggle('ingame', ingame);
    const scr = $('#screen');
    const ae = document.activeElement;
    const botKeep = ae && ae.dataset && ae.dataset.botid ? { id: ae.dataset.botid, v: ae.value, s: ae.selectionStart, e: ae.selectionEnd } : null;
    if (!S.room) {
      $('#hinfo').textContent = '';
      if (paint(scr, homeHTML(), '_k')) { const f = scr.querySelector('#fName'); if (f && document.activeElement === document.body && !S.form.name) f.focus(); }
    } else if (!ingame) {
      $('#hinfo').textContent = 'Stanza ' + S.room.code;
      if (paint(scr, lobbyHTML(), '_k') && botKeep) {
        const el = scr.querySelector(`[data-botid="${botKeep.id}"]`);
        if (el) { el.value = botKeep.v; el.focus(); try { el.setSelectionRange(botKeep.s, botKeep.e); } catch (err) { /* ignore */ } }
      }
    } else renderGame(scr);
    if (peek._el && !peek._el.isConnected) hidePeek();
    if (S.modal) renderModal();
  }
  // Il registro è un contenitore «column-reverse»: il browser lo tiene ancorato all'ultima riga anche
  // quando il contenuto cresce (font, immagini). Lì scrollTop vale 0 in fondo e scende sotto zero risalendo.
  const logRev = el => getComputedStyle(el).flexDirection === 'column-reverse';
  const logGap = el => (logRev(el) ? -el.scrollTop : el.scrollHeight - el.scrollTop - el.clientHeight);
  function renderGame(scr) {
    const v = V(), me = ME(), n = v.players.length;
    $('#hinfo').textContent = `${S.room.code}, giro ${v.turn}`;
    paint(scr, SKELETON, '_k');
    const board = $('#board');
    board.dataset.n = n;
    board.classList.toggle('fighting', !!v.combat);
    const others = Array.from({ length: n - 1 }, (_, i) => v.players[(me.seat + 1 + i) % n]);
    if (paint($('#opps'), others.map(oppHTML).join(''), '_k')) {
      const act = $('#opps .opp.active'); // su telefono la fila scorre: chi è di turno resta in vista
      if (act) { const box = $('#opps'); box.scrollLeft = Math.max(0, act.offsetLeft - (box.clientWidth - act.offsetWidth) / 2); }
    }
    paint($('#piles'), pilesHTML(), '_k');
    paint($('#arena'), arenaHTML(), '_k');
    S.shownUid = v.revealed ? v.revealed.card.uid : null;
    // Il registro segue gli eventi: resta agganciato in fondo, a meno che tu non sia risalito a rileggere.
    const log = $('#log'), ls = log.scrollTop, h0 = log.scrollHeight;
    const opened = S.logOpen && !log._open;
    const atEnd = !log._k || log._open !== S.logOpen || logGap(log) < 48;
    const lastI = v.log && v.log.length ? v.log[v.log.length - 1].i : 0;
    if (atEnd) S.logNew = false; else if (lastI > (S.logSeen || 0)) S.logNew = true;
    S.logSeen = lastI;
    log.classList.toggle('open', S.logOpen); log._open = S.logOpen;
    log.setAttribute('aria-expanded', S.logOpen ? 'true' : 'false');
    if (paint(log, logHTML(), '_k') || atEnd) {
      const rev = logRev(log);
      if (atEnd) log.scrollTop = rev ? 0 : log.scrollHeight;
      else log.scrollTop = rev ? ls - (log.scrollHeight - h0) : ls; // chi sta rileggendo resta dov'era
    }
    if (opened) log.scrollIntoView({ block: 'end' }); // su telefono il registro aperto sta in fondo al tavolo: portalo in vista
    $('#me').classList.toggle('active', v.cur === S.you && !v.over);
    paint($('#me'), meHTML(me), '_k');
    paint($('#handwrap'), handHTML(), '_k');
    v.hand.forEach(c => S.seen.add(c.uid));
    $('#actions').classList.toggle('need', v.needs.includes(S.you) && !v.over);
    paint($('#actions'), actionsHTML(), '_k');
  }

  // Cinque carte vere in apertura: il gioco si presenta con quello che ha di più suo.
  const HERO = ['curse-reset-password-obbligatorio', 'gear-hw-laptop-pieno-di-adesivi', 'threat-ransomware-con-assistenza-clienti', 'role-red', 'oneshot-caffe-della-macchinetta'];
  function homeHTML() {
    return `<div class="home">
      <div class="home-pitch">
        <div class="herofan" aria-hidden="true">${HERO.map(a => `<span class="card"><span class="face" data-art="${a}"><img src="/cards/${a}.jpg" alt=""></span></span>`).join('')}</div>
        <h1>Arriva a root prima dei colleghi.</h1>
        <p class="lead">Card game di sabotaggi e privilege escalation. Vince chi arriva a root per primo; perde chi lascia tracce nei log. Da 3 a 6 giocatori, con bot per i colleghi che «oggi non riescono».</p>
      </div>
      <div class="home-forms">
        <section class="panel"><h2>Crea una stanza</h2>
          <div class="field"><label for="fName">Il tuo nome</label><input id="fName" data-f="name" maxlength="20" autocomplete="nickname" value="${esc(S.form.name)}"></div>
          <button class="btn primary" type="button" data-do="create"${S.online ? '' : ' disabled'}>Crea una stanza</button></section>
        <section class="panel"><h2>Entra in una stanza</h2>
          <div class="field"><label for="fCode">Codice stanza</label><input id="fCode" class="codein" data-f="code" maxlength="5" autocapitalize="characters" autocomplete="off" spellcheck="false" value="${esc(S.form.code)}"></div>
          <button class="btn" type="button" data-do="join"${S.online ? '' : ' disabled'}>Entra</button>
          <p class="hint">Usa il nome scritto qui accanto.</p></section>
        ${S.online ? '' : '<p class="hint wide">Connessione al server in corso…</p>'}
      </div></div>`;
  }

  function lobbyHTML() {
    const r = S.room, isHost = r.host === S.you, link = location.origin + '/?r=' + r.code;
    const seats = r.members.map((m, i) => `<li class="seat" data-seat="${i}">
      <span class="ava" data-seat="${i}" aria-hidden="true">${esc(ini(m.name))}</span>
      ${isHost && m.isBot
        ? `<input class="botname inline" data-botid="${esc(m.id)}" maxlength="20" value="${esc(m.name)}" aria-label="Nome del bot">`
        : `<span class="nm">${esc(m.name)}</span>`}
      <span class="tags">${m.id === S.you ? '<span class="badge you">tu</span>' : ''}${m.id === r.host ? '<span class="badge host">host</span>' : ''}${m.isBot ? '<span class="badge bot">bot</span>' : ''}${!m.connected ? '<span class="badge off">offline</span>' : ''}</span>
      ${isHost && m.id !== S.you ? `<button type="button" class="xbtn" data-do="remove" data-id="${esc(m.id)}" aria-label="Rimuovi ${esc(m.name)}">✕</button>` : ''}</li>`).join('');
    const n = r.members.length, ready = n >= r.min;
    const free = Array.from({ length: r.max - n }, (_, i) => `<li class="seat free">${n + i < r.min ? 'Posto da riempire' : 'Posto libero'}</li>`).join('');
    const need = Math.max(0, r.min - n);
    const status = ready
      ? (isHost ? 'Pronti: puoi avviare quando vuoi.' : 'In attesa che l\'host avvii la partita.')
      : `In attesa di giocatori: ${need === 1 ? 'ne serve ancora 1' : 'ne servono ancora ' + need}.`;
    return `<div class="lobby">
      <section class="panel lobby-room">
        <h2>Invita i colleghi</h2>
        <p class="code" aria-label="Codice stanza ${esc(r.code.split('').join(' '))}">${esc(r.code)}</p>
        <p class="link">${esc(link)}</p>
        <button class="btn" type="button" data-do="copy">Copia link d'invito</button>
      </section>
      <section class="panel lobby-players">
        <h2>Al tavolo <span class="count">${n}/${r.max}</span></h2>
        <p class="lobby-status${ready ? ' ready' : ''}">${esc(status)}</p>
        <ul class="members">${seats}${free}</ul>
        ${isHost ? `<div class="row lobby-host">
            <input id="fBot" class="botname" data-f="bot" maxlength="32" aria-label="Nome del bot" value="${esc(S.form.bot != null ? S.form.bot : (r.nextBot || ''))}"${n >= r.max ? ' disabled' : ''}>
            <button class="btn" type="button" data-do="addBot"${n >= r.max ? ' disabled' : ''}>Aggiungi un bot</button>
          </div>
          <button class="btn primary big" type="button" data-do="start"${!ready ? ' disabled' : ''}>Avvia la partita</button>
          <p class="hint">${!ready ? `Servono almeno ${r.min} giocatori: invita con il link oppure riempi i posti con dei bot.` : `Puoi ancora aggiungere bot fino a ${r.max} giocatori.`}</p>`
          : `<p class="hint">Solo l'host può avviare la partita.</p>`}
      </section></div>`;
  }

  // Segnalini temporanei: turno da saltare, Risposta automatica attiva.
  const flags = p => `${p.skip ? ' <span class="badge skip" title="Salta il prossimo turno">salta il turno</span>' : ''}${p.ooo ? ' <span class="badge ooo" title="Risposta automatica: la prossima Sfiga torna al mittente">fuori ufficio</span>' : ''}`;
  function oppHTML(p) {
    const v = V(), c = v.combat, m = member(p.id);
    const turn = v.cur === p.id && !v.over;
    let st = '';
    if (c) {
      if (c.offer && c.offer.to === p.id) st = `<span class="st wait">${c.offer.round ? 'valuta proposta' : 'valuta aiuto'}</span>`;
      else if (p.id === c.fighter) st = `<span class="st fight">combatte${c.step === 'window' && passed(p.id) ? ' ✓' : ''}</span>`;
      else if (p.id === c.helper) st = `<span class="st help">aiuta${c.step === 'window' && passed(p.id) ? ' ✓' : ''}</span>`;
      else if (c.step === 'window') st = passed(p.id) ? '<span class="st ok">passo ✓</span>' : '<span class="st wait">decide</span>';
    } else if (v.over && v.winner === p.id) st = '<span class="st ok">root</span>';
    else if (turn) st = '<span class="st wait">di turno</span>';
    const off = m && !m.connected, gear = p.gear || {};
    return `<div class="opp${turn ? ' active' : ''}${off ? ' off' : ''}" data-pid="${esc(p.id)}" data-seat="${p.seat}" role="button" tabindex="0" aria-label="${esc(p.name)}, livello ${p.level}">${st}
      <div class="id">${avaHTML(p)}
        <div class="who"><div class="on">${esc(p.name)}</div><div class="tt">${esc(p.title)}${p.isBot ? ' <span class="badge bot">bot</span>' : off ? ' <span class="badge off">offline</span>' : ''}${flags(p)}</div></div>
        <span class="lvl" title="Livello">${p.level}</span></div>
      <div class="ostats"><span><small>Forza</small><b>${p.power - p.penalty}</b></span><span><small>Carte</small><b>${p.handCount}</b></span><span class="oesp"><small><span class="lg-only">Esposizione</span><span class="sm-only" title="Esposizione">Esp.</span></small>${espPips(p)}</span></div>
      <div class="minis">${p.role ? cardHTML(p.role, { mini: true }) : '<span class="oslot" title="Nessun ruolo">Ruolo</span>'}${Object.keys(SLOTS).map(s => gear[s] ? cardHTML(gear[s], { mini: true }) : `<span class="oslot" title="${SLOTS[s]}: vuoto">${s.toUpperCase()}</span>`).join('')}</div></div>`;
  }

  // Il mazzo Ticket è anche un comando: nel tuo turno ci clicchi sopra per aprire un ticket o analizzare i log.
  function pilesHTML() {
    const v = V(), mine = v.cur === S.you && !v.combat && !v.over && !S.tut;
    const d = mine && v.phase === 'open' ? 'open' : mine && v.phase === 'after' ? 'loot' : '';
    const tip = d === 'open' ? 'Apri un ticket' : d === 'loot' ? 'Analizza i log' : '';
    return `<${d ? `button type="button" data-do="${d}"` : 'div'} class="pile t${d ? ' can' : ''}" aria-label="Mazzo Ticket: ${v.deck.T} carte${tip ? '. ' + tip : ''}">${backHTML('ticket')}<b>${v.deck.T}</b><small>${tip || 'Ticket'}</small></${d ? 'button' : 'div'}>
      <div class="pile a" aria-label="Mazzo Asset: ${v.deck.A} carte">${backHTML('asset')}<b>${v.deck.A}</b><small>Asset</small></div>`;
  }

  const hud = (k, m, cls = '') => `<div class="hud${cls}" role="status"><span class="hud-k">${k}</span><span class="hud-m">${m}</span></div>`;
  function arenaHTML() {
    const v = V(), c = v.combat, me = ME();
    if (c) {
      const f = P(c.fighter), h = c.helper ? P(c.helper) : null;
      const fdet = [`livello ${f.level}`, `asset +${sumGear(f)}`];
      if (c.fBonus) fdet.push(`bonus ${c.fBonus > 0 ? '+' : '−'}${Math.abs(c.fBonus)}`); // negativo se l'IA ha allucinato
      if (f.penalty) fdet.push(`policy −${f.penalty}`);
      if (h) fdet.push(`${h.name} +${h.power}`);
      const multi = c.threats.length > 1;
      const mdet = multi ? c.threats.map(t => `${t.card.name} ${t.eff}${t.mod ? (t.mod > 0 ? ' +' : ' ') + t.mod : ''}`) : c.threats.map(t => `forza ${t.eff}${t.mod ? (t.mod > 0 ? ' +' : ' ') + t.mod : ''}`);
      if (c.mBonus) mdet.push(`interferenze ${c.mBonus > 0 ? '+' : '−'}${Math.abs(c.mBonus)}`);
      let k = 'Combattimento', m = '';
      const mineFight = c.fighter === S.you;
      if (c.step === 'prep') { k = 'Preparazione'; m = mineFight ? 'Usa carte o chiedi aiuto, poi combatti.' : `${esc(f.name)} si prepara. Poi tocca a tutti dire «passo».`; }
      else if (c.step === 'window') {
        // chi manca si legge sui badge («decide» / «passo»): qui basta il conto, o i nomi se sono pochi
        const waiting = v.players.filter(p => !passed(p.id)).map(p => p.id === S.you ? 'tu' : p.name);
        const left = waiting.length > 2 ? `Devono ancora decidere in ${waiting.length}.` : `${waiting.length === 1 ? 'Manca' : 'Mancano'} ${esc(waiting.join(' e ') || 'nessuno')}.`;
        k = c.frozen ? 'Change freeze' : 'Finestra di interferenza';
        m = passed(S.you) ? `Hai passato. ${left}` : c.frozen ? `Non si gioca più niente: si può solo passare. ${left}` : `Gioca una carta o passa. ${left}`;
      } else if (c.step === 'flee') { k = 'Fuga'; m = mineFight ? 'Sei in svantaggio: tira il dado.' : `${esc(f.name)} deve tentare la fuga.`; }
      if (c.offer) {
        const o = c.offer, n = `${o.share} ${pl(o.share, 'tesoro', 'tesori')}`;
        k = o.round ? 'Trattativa' : 'Richiesta di aiuto';
        m = (o.round ? `${esc(name(o.from))} rilancia con ${esc(name(o.to))}: ${n} all'aiutante.` : `${esc(name(o.from))} chiede aiuto a ${esc(name(o.to))} per ${n}.`) + ` Risposta entro ${cd('offer')}`;
      }
      const diff = Math.abs(c.fighterPower - c.threatPower);
      return `${hud(k, m, (v.needs.includes(S.you) ? ' need' : '') + (c.step === 'window' ? ' win' : ''))}
        <div class="duel${multi ? ' multi' : ''}">
          <div class="side f"><div class="side-h">${avaHTML(f)}${h ? avaHTML(h) : ''}<span class="lab">${esc(f.name)}${h ? ' + ' + esc(h.name) : ''}</span></div><div class="pow">${c.fighterPower}</div><div class="det">${fdet.map(x => `<span>${esc(x)}</span>`).join('')}</div></div>
          <div class="vs ${c.winning ? 'w' : 'l'}"><span class="burst" aria-hidden="true">VS</span><b>${c.winning ? 'vince' : 'perde'}</b><small>${diff ? 'di ' + diff : 'in pareggio'}</small></div>
          <div class="side m"><div class="side-h"><span class="lab">${multi ? 'Minacce' : esc(c.threats[0].card.name)}</span></div><div class="pow">${c.threatPower}</div><div class="det">${mdet.map(x => `<span>${esc(x)}</span>`).join('')}</div></div>
          <div class="threats">${c.threats.map(t => cardHTML(t.card, { lg: true })).join('')}</div>
        </div>
        <p class="stake">In palio: <b>+${c.levels} ${pl(c.levels, 'livello', 'livelli')}</b> e <b>${c.treasures} ${pl(c.treasures, 'tesoro', 'tesori')}</b>${h ? ` (${c.share} a ${esc(h.name)})` : ''}</p>`;
    }
    if (v.over) {
      const rank = v.players.slice().sort((a, b) => (b.id === v.winner) - (a.id === v.winner) || b.level - a.level);
      return `${hud(v.winner === S.you ? 'Hai vinto' : 'Partita finita', v.winner === S.you ? 'Hai ottenuto root. Ora la reperibilità è tua.' : `${esc(name(v.winner))} ha ottenuto root. Cambiate le password.`, ' over')}
        <div class="finale"><span class="burst big" aria-hidden="true">root</span>
          <ol class="rank">${rank.map(p => `<li${p.id === v.winner ? ' class="first"' : ''}>${avaHTML(p)}<span class="nm">${esc(p.name)}</span><span class="tt">${esc(p.title)}</span><b>${p.level}</b></li>`).join('')}</ol></div>`;
    }
    let k, m, cls = '';
    if (S.tut) { k = 'In pausa'; m = `In attesa che tutti chiudano le istruzioni (${S.tut.ready}/${S.tut.total}).`; }
    else if (v.cur === me.id) {
      k = 'Il tuo turno'; cls = ' need';
      m = {
        open: 'Equipaggia, assumi un ruolo, usa i livelli. Poi apri un ticket: qualcuno deve pur farlo.',
        after: 'Nessuna minaccia: la carta è tua. Puoi cercare guai (tocca una Minaccia in mano), analizzare i log o chiudere il turno.',
        end: 'Chiudi il turno quando hai finito.'
      }[v.phase] || '';
    } else { k = `Turno di ${esc(name(v.cur))}`; m = 'Intanto puoi equipaggiarti. Le Sfighe si giocano in qualsiasi momento.'; }
    const r = v.revealed;
    const rv = r
      ? `<figure class="shown">${cardHTML(r.card, { lg: true, fresh: r.card.uid !== S.shownUid })}<figcaption><b class="shown-n">${esc(r.card.name)}</b>${fxHTML(r.card)}<p class="by">Ticket aperto da ${esc(name(r.by))}</p></figcaption></figure>`
      : `<div class="spot"><span>Il prossimo ticket finisce qui</span></div>`;
    return `${hud(k, m, cls)}<div class="play">${rv}</div>`;
  }

  // Registro: come una chat, l'ultima riga in basso. Le battute diventano fumetti di chi ha appena agito.
  function logHTML() {
    const v = V(), log = v.log || [];
    const names = v.players.map(p => p.name).sort((a, b) => b.length - a.length);
    const rows = [];
    log.slice(-60).forEach((r, i, a) => {
      if (r.cls !== 'quip') { rows.push(`<li class="l ${esc(r.cls)}">${esc(r.t)}</li>`); return; }
      const prev = (a[i - 1] && a[i - 1].t) || '';
      const who = names.find(n => prev.startsWith(n)) || '';
      rows.push(`<li class="l quip${who && who === ME().name ? ' mine' : ''}"><span class="bubble">${esc(String(r.t).replace(/^«\s*|\s*»$/g, ''))}</span></li>`);
    });
    return `${S.logNew ? '<button type="button" class="lognew" data-do="logEnd">Nuovi eventi ↓</button>' : ''}<div class="logwrap"><h3>Registro</h3><ol class="feed" aria-live="polite">${rows.join('')}</ol></div>`;
  }

  function meHTML(me) {
    const cr = Math.max(0, Math.min(10, Math.floor(me.credit / 100)));
    const slot = s => {
      const g = me.gear[s];
      return `<button type="button" class="slot${g ? ' full' : ''}" data-slot="${s}" aria-label="${SLOTS[s]}${g ? ': ' + esc(g.name) + ', +' + me.gearBonus[s] : ': vuoto'}">${g ? faceHTML(g) + `<span class="sb">+${me.gearBonus[s]}</span>` : ''}<span class="sl">${SLOTS[s]}</span></button>`;
    };
    return `<div class="id" data-seat="${me.seat}">${avaHTML(me)}
        <div class="who"><div class="on">${esc(me.name)}</div><div class="tt">${esc(me.title)}${flags(me)}</div></div>
        <span class="lvl" title="Livello">${me.level}</span></div>
      <div class="stats">
        <span><small>Forza</small><b>${me.power - me.penalty}${me.penalty ? `<em class="r" title="Penalità al prossimo combattimento">policy −${me.penalty}</em>` : ''}</b></span>
        <span class="credit"><small>Credito</small><b>${me.credit}</b><i class="bar c${cr}" title="1000 di credito valgono un livello"></i></span>
        <span><small>Esposizione</small>${espPips(me)}</span></div>
      <div class="slots"><button type="button" class="slot role${me.role ? ' full' : ''}" data-role="1" aria-label="Ruolo: ${me.role ? esc(me.role.name) : 'nessuno'}">${me.role ? faceHTML(me.role) + (me.blueReady ? '<span class="sb">scudo</span>' : '') : ''}<span class="sl">${me.role ? esc(me.role.name) : 'Ruolo'}</span></button>${Object.keys(SLOTS).map(slot).join('')}</div>`;
  }

  // Evidenzia le carte che in questo momento hanno un uso legato alla situazione (non la normale gestione).
  function playableNow(card) {
    const v = V(), c = v.combat;
    if (v.over) return false;
    if (!c) return card.type === 'threat' && v.cur === S.you && v.phase === 'after';
    if (card.type === 'oneshot' && card.escape) return c.step === 'flee' && c.fighter === S.you;
    if (card.type === 'trick') return trickNow(card);
    if (c.frozen || !((c.step === 'prep' && (c.fighter === S.you || c.helper === S.you)) || c.step === 'window')) return false;
    return card.type === 'oneshot' || card.type === 'boost' || (card.type === 'lateral' && v.hand.some(x => x.type === 'threat'));
  }
  // Una carta speciale si può giocare in questo momento del combattimento? (le regole vere le applica il server)
  function trickNow(card) {
    const v = V(), c = v.combat, me = S.you;
    if (!c || v.over) return false;
    const fighter = c.fighter === me, mine = fighter || c.helper === me;
    if (card.fx === 'scapegoat') return c.step === 'flee' && fighter;
    if (card.fx === 'ooo') return false;
    if (c.frozen || c.step === 'flee') return false;
    if (card.fx === 'reassign') return c.step === 'prep' && fighter && !c.reassigned && !c.helper && !c.offer;
    if (!(c.step === 'window' || mine)) return false;
    const mp = P(c.fighter).level + c.levels >= 10;
    switch (card.fx) {
      case 'poach': return !!c.helper && !mine;
      case 'freeze': return c.step === 'window' && !mp;
      case 'honeypot': return !!c.lastSab && c.lastSab.by !== me;
      case 'falsepos': return mine || !mp;
      case 'oncall': return fighter && !c.helper;
      case 'ai': case 'reboot': return true;
    }
    return false;
  }
  function handHTML() {
    const v = V(), over = v.hand.length > v.handMax && !v.over;
    return `<div class="handhead"><span>La tua mano</span><b class="${over ? 'r' : ''}">${v.hand.length}/${v.handMax}</b>${over ? '<span class="r">a fine turno scegli cosa scartare</span>' : ''}</div>
      <div class="hand" data-n="${Math.min(v.hand.length, 12)}">${v.hand.map(c => cardHTML(c, { can: playableNow(c), fresh: !S.seen.has(c.uid) })).join('') || '<span class="hintbig">Mano vuota.</span>'}</div>`;
  }

  function actionsHTML() {
    const v = V(), c = v.combat, me = S.you, isHost = S.room.host === me;
    const B = (d, label, cls = '', dis = false) => `<button type="button" class="btn ${cls}" data-do="${d}"${dis ? ' disabled' : ''}>${esc(label)}</button>`;
    const out = (hint, btns = '') => `<div class="dock-top">${v.over ? '' : S.tut ? '<span class="hud-cd hold">pausa</span>' : `<span class="hud-cd" data-cd="main">${mmss(S.deadlineAt - Date.now())}</span>`}<p class="hint">${hint}</p></div>${btns ? `<div class="btns">${btns}</div>` : ''}`;
    if (v.over) return out(isHost ? 'Stessa stanza, stessi colleghi.' : 'In attesa che l\'host proponga la rivincita.', (isHost ? B('rematch', 'Rivincita', 'primary') : '') + B('leave', 'Esci', 'ghost'));
    if (c) {
      if (c.offer && c.offer.to === me) return out(`${esc(name(c.offer.from))} ${c.offer.round ? 'ha rilanciato' : 'ti chiede aiuto'}. Rispondi entro ${cd('offer')}`, B('offer', 'Rispondi', 'primary'));
      const fighter = c.fighter === me, canAsk = fighter && !c.helper && !c.offer;
      if (c.offer && c.offer.from === me && !fighter) return out(`Hai proposto ${c.offer.share} ${pl(c.offer.share, 'tesoro', 'tesori')} a ${esc(name(c.offer.to))}. Risposta entro ${cd('offer')}`, B('cancelHelp', 'Ritira la proposta', 'ghost'));
      if (c.step === 'prep') {
        if (fighter) return out('Prima di combattere puoi usare carte o chiedere aiuto. Poi si apre la finestra per gli altri.', (canAsk ? B('help', 'Chiedi aiuto') : '') + B('fight', 'Combatti', 'primary'));
        return out(`${esc(name(c.fighter))} si prepara. Potrai interferire quando si apre la finestra.`);
      }
      if (c.step === 'window') {
        if (passed(me)) return out('Hai passato. Ora guardi e basta, come in ogni post-mortem. Se qualcuno gioca una carta dovrai decidere di nuovo.');
        if (canAutopass()) return out(c.frozen ? 'Change freeze: passo automatico tra pochi secondi.' : 'Non hai carte da combattimento: passo automatico tra pochi secondi.', B('pass', 'Passo ora', 'primary'));
        if (c.frozen) return out('Change freeze: nessuno può più giocare carte o chiedere aiuto. Resta solo da passare.', B('pass', fighter ? (c.winning ? 'Passo: chiudo e vinco' : 'Passo: vado alla fuga') : 'Passo', 'primary'));
        const extra = fighter && c.offer && c.offer.from === me ? B('cancelHelp', 'Annulla richiesta', 'ghost') : canAsk ? B('help', 'Chiedi aiuto') : '';
        const label = fighter ? (c.winning ? 'Passo: chiudo e vinco' : 'Passo: vado alla fuga') : 'Passo';
        const tip = fighter ? (c.winning ? 'Sei in vantaggio. Gli altri possono ancora sabotarti finché non passano tutti.' : 'Sei in svantaggio: gioca carte o chiedi aiuto prima di passare.')
          : c.winning ? `${esc(name(c.fighter))} sta vincendo: tocca una carta per sabotare (+1 Esposizione) oppure passa.` : `${esc(name(c.fighter))} sta perdendo. Puoi passare, o aiutarlo con una carta.`;
        return out(tip, extra + B('pass', label, 'primary'));
      }
      if (c.step === 'flee' && fighter) return out('Tira il dado e spera che la VPN cada al momento giusto. Se hai un Rollback o un Capro espiatorio, toccalo nella mano.', B('flee', 'Tenta la fuga', 'danger'));
      return out(`${esc(name(c.fighter))} tenta la fuga…`);
    }
    if (v.cur === me) {
      if (v.phase === 'open') return out('Tocca a te.', B('open', 'Apri un ticket', 'primary'));
      if (v.phase === 'after') return out('Niente combattimento in questo turno.', B('endTurn', 'Fine turno') + B('loot', 'Analizza i log', 'primary'));
      const ex = v.hand.length - v.handMax;
      return out(ex > 0 ? `Hai ${ex} ${pl(ex, 'carta', 'carte')} di troppo.` : 'Hai finito?', B('endTurn', ex > 0 ? `Fine turno (scarti ${ex})` : 'Fine turno', 'primary'));
    }
    return out(`Turno di ${esc(name(v.cur))}.`);
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
    paint(el, `<div class="mbox${m.cls ? ' ' + m.cls : ''}" role="dialog" aria-modal="true"><h3>${esc(typeof m.title === 'function' ? m.title() : m.title)}</h3><div class="mbody">${m.html()}</div>
      <div class="mbtns">${btns.map((b, i) => `<button type="button" class="btn ${b.cls || ''}" data-mi="${i}"${b.disabled ? ' disabled' : ''}>${esc(b.label)}</button>`).join('')}</div></div>`, '_k');
    el.classList.remove('hidden');
  }
  // Passo automatico: solo se non hai nulla da giocare nel combattimento, con ritardo casuale
  // così il tempo di risposta non rivela agli altri che sei senza carte.
  function canAutopass() {
    const v = V(), c = v && v.combat;
    if (!S.autopass || !c || c.step !== 'window' || passed(S.you) || c.fighter === S.you || c.helper === S.you || (c.offer && c.offer.to === S.you)) return false;
    if (c.frozen) return true;
    return !v.hand.some(k => (k.type === 'oneshot' && !k.escape) || k.type === 'boost' || (k.type === 'lateral' && v.hand.some(t => t.type === 'threat')) || (k.type === 'trick' && trickNow(k)));
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
      const key = `${v.gid}|${c.offer.from}|${c.offer.share}|${c.offer.round}|${c.asked.length}|${c.threats[0].card.uid}`;
      if (S.offerShown !== key) { S.offerShown = key; openOfferModal(); }
    }
  }

  function openSheet(uid, where) {
    const find = () => (where === 'hand' ? V().hand.find(c => c.uid === uid) : where === 'slot' ? Object.values(ME().gear).find(g => g && g.uid === uid) : where === 'role' ? ME().role : null);
    const card = () => (where === 'view' ? findPublic(uid) : find());
    openModal({
      dismiss: true, cls: 'sheet',
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
    const inFight = !!c && !c.frozen && ((c.step === 'prep' && (c.fighter === S.you || c.helper === S.you)) || c.step === 'window');
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
      case 'trick': {
        const others = v.players.filter(p => p.id !== S.you), T = (extra = {}) => go({ type: 'trick', card: card.uid, ...extra });
        if (card.fx === 'ooo') { if (!me.ooo) B.push({ label: 'Attiva: la prossima Sfiga torna al mittente', cls: 'primary', on: T() }); }
        else if (trickNow(card)) {
          switch (card.fx) {
            case 'poach': B.push({ label: `Porta via ${name(c.helper)} · sabotaggio`, cls: 'danger', on: T() }); break;
            case 'freeze': B.push({ label: 'Congela: da ora si può solo passare', cls: 'primary', on: T() }); break;
            case 'honeypot': B.push({ label: `Annulla «${c.lastSab.name}» di ${name(c.lastSab.by)}`, cls: 'primary', on: T() }); break;
            case 'falsepos': B.push({ label: mine ? 'Annulla il combattimento: niente premi, niente penalità' : `Annulla il combattimento di ${name(c.fighter)}${c.winning ? ' · sabotaggio' : ''}`, cls: mine || !c.winning ? 'primary' : 'danger', on: T() }); break;
            case 'reboot': B.push({ label: 'Azzera tutti i bonus e le interferenze', cls: 'primary', on: T() }); break;
            case 'ai':
              B.push({ label: mine ? 'Tira il dado per il tuo lato' : `Tira il dado per ${name(c.fighter)}`, cls: mine ? 'primary' : '', on: T({ side: 'f' }) });
              B.push({ label: `Tira il dado per la minaccia${mine ? '' : ' · sabotaggio'}`, cls: mine ? '' : 'danger', on: T({ side: 'm' }) });
              break;
            case 'oncall': others.forEach(p => B.push({ label: `Metti di reperibilità ${p.name} (forza ${p.power})`, cls: 'primary', on: T({ target: p.id }) })); break;
            case 'scapegoat': others.forEach(p => B.push({ label: `Se ti prendono paga ${p.name} (liv ${p.level}) · sabotaggio`, cls: 'danger', on: T({ target: p.id }) })); break;
            case 'reassign': others.forEach(p => B.push({ label: `Riassegna a ${p.name} (forza ${p.power - p.penalty}) · sabotaggio`, cls: 'danger', on: T({ target: p.id }) })); break;
          }
        }
        if (free && card.value) B.push({ label: `Vendi per ${card.value} di credito`, on: go({ type: 'sell', card: card.uid }) });
        break;
      }
      case 'lateral':
        if (inFight) v.hand.filter(x => x.type === 'threat').forEach(th => B.push({ label: `Aggiungi ${th.name} (forza ${th.l})${mine ? '' : ' · sabotaggio'}`, cls: mine ? '' : 'danger', on: go({ type: 'play', card: card.uid, threat: th.uid }) }));
        break;
    }
    if (free && !['gear', 'oneshot'].includes(card.type) && !(card.type === 'trick' && card.value)) B.push({ label: 'Scarta', cls: 'ghost', on: go({ type: 'discard', card: card.uid }) });
    return B;
  }

  function openHelpModal() {
    const st = { share: Math.floor((V().combat ? V().combat.treasures : 0) / 2) };
    openModal({
      dismiss: true, title: 'Chiedi aiuto',
      valid: () => { const c = V() && V().combat; return !!(c && c.fighter === S.you && !c.helper && !c.offer); },
      html: () => {
        const c = V().combat;
        return `<p>Chi accetta somma la sua forza alla tua e pesca per primo i tesori che gli offri. Non guadagna livelli. Può anche rilanciare con un'altra cifra. Una richiesta alla volta.</p>
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

  // Risposta a una proposta di aiuto. Dopo una controproposta i ruoli si invertono:
  // la stessa finestra serve sia a chi viene chiamato in aiuto sia a chi combatte.
  function openOfferModal() {
    const st = { share: null };
    const off = () => { const c = V() && V().combat; return c && c.offer && c.offer.to === S.you ? c : null; };
    // la controproposta deve essere diversa dalla cifra sul tavolo: il selettore la salta
    const step = (c, d) => { let s = st.share + d; if (s === c.offer.share) s += d; return s < 0 || s > c.treasures ? st.share : s; };
    // cifra di partenza: chi aiuta chiede un tesoro in più, chi combatte ne lascia uno in meno
    const init = c => { if (st.share !== null) return; const up = c.fighter === S.you ? -1 : 1; st.share = c.offer.share; st.share = step(c, up); if (st.share === c.offer.share) st.share = step(c, -up); };
    openModal({
      title: () => { const c = off(); return c && c.offer.round ? 'Controproposta' : 'Richiesta di aiuto'; },
      valid: () => !!off(),
      html: () => {
        const c = off(), o = c.offer, f = P(c.fighter), mine = c.fighter === S.you, h = mine ? P(o.from) : ME();
        const n = `<b>${o.share}</b> ${pl(o.share, 'tesoro', 'tesori')} su ${c.treasures}`;
        const names = c.threats.map(t => t.card.name).join(' + ');
        init(c);
        const can = o.canCounter && st.share !== o.share;
        const lead = mine ? `<p><b>${esc(h.name)}</b> ti aiuta contro <b>${esc(names)}</b>, ma vuole ${n}.</p>`
          : o.round ? `<p><b>${esc(f.name)}</b> rilancia: ti offre ${n} per l'aiuto contro <b>${esc(names)}</b>.</p>`
            : `<p><b>${esc(f.name)}</b> ti chiede aiuto contro <b>${esc(names)}</b> e ti offre ${n}.</p>`;
        return `${lead}
          <p>${mine ? 'Da solo' : 'Da solo ha'}: ${c.fighterPower} contro ${c.threatPower}. Con ${mine ? esc(h.name) : 'te'}: ${c.fighterPower + h.power}.${mine ? '' : ' Tu non guadagni livelli.'}</p>
          ${!mine && f.level + c.levels >= 10 ? '<p class="warn">Se vince, vince la partita.</p>' : ''}
          ${can ? `<p>Oppure rilancia. Tesori ${mine ? 'che gli lasci' : 'che chiedi'}:</p>
            <div class="stepper"><button type="button" data-m="minus" aria-label="Meno">−</button><b>${st.share}</b><button type="button" data-m="plus" aria-label="Più">+</button></div>`
            : o.canCounter ? '' : '<p>Trattativa al limite: puoi solo accettare o rifiutare.</p>'}
          <p class="hint">Rispondi entro <span class="hud-cd" data-cd="offer">${mmss(S.offerAt - Date.now())}</span></p>`;
      },
      onBody: el => { const c = off(); if (!c) return; if (el.dataset.m === 'minus') st.share = step(c, -1); if (el.dataset.m === 'plus') st.share = step(c, 1); },
      buttons: () => {
        const c = off(), B = [{ label: 'Accetta', cls: 'primary', on: () => act({ type: 'answerHelp', accept: true }) }];
        if (c) init(c);
        if (c && c.offer.canCounter && st.share !== c.offer.share) B.push({ label: `Rilancia a ${st.share} ${pl(st.share, 'tesoro', 'tesori')}`, on: () => act({ type: 'counterHelp', share: st.share }) });
        B.push({ label: 'Rifiuta', cls: 'ghost', on: () => act({ type: 'answerHelp', accept: false }) });
        return B;
      }
    });
  }

  function openDiscardModal() {
    const st = { sel: new Set() };
    openModal({
      dismiss: true, cls: 'wide', title: 'Limite di mano',
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
        return `<div class="oppcard"><div class="id" data-seat="${p.seat}">${avaHTML(p)}<div class="who"><div class="on">${esc(p.name)}</div><div class="tt">${esc(p.title)}</div></div><span class="lvl">${p.level}</span></div>
          <dl class="facts"><div><dt>Forza</dt><dd>${p.power - p.penalty}</dd></div><div><dt>Carte in mano</dt><dd>${p.handCount}</dd></div><div><dt>Credito</dt><dd>${p.credit}</dd></div><div><dt>Esposizione</dt><dd>${p.esp}/${V().espMax}</dd></div></dl></div>
          <p><b>Ruolo:</b> ${p.role ? esc(p.role.name) + '. ' + esc((ROLES[p.role.role] || { text: '' }).text) : 'nessuno'}</p>
          <p><b>Asset equipaggiati</b></p><ul class="gearlist">${gs.length ? gs.map(([s, g]) => `<li>${faceHTML(g)}<span>${esc(g.name)}<small>${SLOTS[s]}, +${p.gearBonus[s]}</small></span></li>`).join('') : '<li class="none">Nessuno.</li>'}</ul>`;
      },
      buttons: () => [{ label: 'Chiudi', cls: 'primary' }]
    });
  }

  const WIKI = { threat: 'Minacce', curse: 'Sfighe', boost: 'Interferenze', lateral: 'Interferenze', role: 'Ruoli', gear: 'Asset', oneshot: 'Uso singolo', levelup: 'Livello' };
  const wikiOf = x => (x.type === 'trick' ? (x.deck === 'T' ? 'Interferenze' : 'Uso singolo') : WIKI[x.type]);
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
      <div class="wiki">${all.map((x, i) => wikiOf(x) !== st.f ? '' : `<button type="button" class="wiki-i" data-m="c:${i}"><span class="face" data-art="${artSlug(x)}"><img src="/cards/${artSlug(x)}.jpg" alt="" loading="lazy"></span><span>${esc(x.name)}</span><small>×${x.n}</small></button>`).join('')}</div>`;
  }
  function openRules() {
    const st = S.rulesUi || (S.rulesUi = { tab: 'rules', f: 'Minacce', sel: -1 });
    if (st.tab === 'wiki') loadCatalog();
    openModal({
      dismiss: true, cls: 'wide', title: 'Regole di ESCALATION',
      onBody: el => {
        const [k, v] = el.dataset.m.split(':');
        if (k === 'tab') { st.tab = v; if (v === 'wiki') loadCatalog(); }
        if (k === 'f') st.f = v;
        st.sel = k === 'c' ? +v : -1;
      },
      buttons: () => [
        { label: 'Come si gioca in 3 schede', on: openTut },
        { label: `Passo automatico senza carte da combattimento: ${S.autopass ? 'attivo' : 'disattivo'}`, on: () => { S.autopass = !S.autopass; store.set('esc-autopass', S.autopass); scheduleAutopass(); toast(`Passo automatico ${S.autopass ? 'attivato' : 'disattivato'}.`); openRules(); } },
        { label: 'Chiudi', cls: 'primary' }
      ],
      html: () => `<div class="tabs" role="tablist">${[['rules', 'Come si gioca'], ['wiki', 'Wiki carte']].map(([k, l]) => `<button type="button" role="tab" class="btn${st.tab === k ? ' primary' : ''}" data-m="tab:${k}" aria-selected="${st.tab === k}">${l}</button>`).join('')}</div>
        <div class="rules">${st.tab === 'wiki' ? wikiHTML(st) : `
        <h4>Obiettivo</h4><p>Arrivare per primi al livello 10, <b>root</b>. L'ultimo livello si ottiene solo neutralizzando una Minaccia: carte livello e credito si fermano al 9.</p>
        <h4>Le carte</h4><ul>
        <li><b>Mazzo Ticket</b>: Minacce da combattere, Sfighe da giocare sugli altri, Ruoli, Interferenze che cambiano un combattimento (forza in più o in meno, aiutanti portati via, sabotaggi annullati).</li>
        <li><b>Mazzo Asset</b>: equipaggiamento per i 4 slot, carte a uso singolo (bonus, fughe, scaricabarile) e carte livello.</li></ul>
        <p>Cosa fa ogni carta, con forza, effetti e numero di copie: scheda <b>Wiki carte</b> qui sopra.</p>
        <h4>Il tuo turno</h4><ul>
        <li><b>Dotazione</b>: finché sei a livello 1, a inizio turno peschi un Asset.</li>
        <li><b>Apri un ticket</b>: carta scoperta. Se è una Minaccia la combatti subito. Qualsiasi altra carta, Sfighe comprese, la prendi in mano.</li>
        <li>Se non hai combattuto: <b>cerca guai</b> (affronti una Minaccia dalla mano) o <b>analizza i log</b> (peschi una carta coperta).</li>
        <li><b>Fine turno</b>: massimo 5 carte in mano, scegli tu cosa scartare.</li></ul>
        <h4>Combattimento</h4><p>Forza = livello + asset + carte a uso singolo. Chi combatte si prepara, poi si apre la <b>finestra di interferenza</b>: tutti, compreso chi combatte, devono dichiarare «passo». Ogni carta giocata riapre il giro dei passo, comprese le Sfighe su chi combatte o su chi lo aiuta. Quando tutti hanno passato: se sei in vantaggio vinci livelli e tesori, altrimenti tiri il dado per fuggire (5+, Sysadmin 3+).</p>
        <h4>Aiuto</h4><p>Chi combatte può chiedere aiuto a un avversario offrendo una parte dei tesori. Chi riceve la proposta può accettare, rifiutare o rilanciare con un'altra cifra; a quel punto risponde l'altro, fino a tre controproposte. L'aiutante somma la sua forza, pesca per primo la sua parte e non guadagna livelli.</p>
        <h4>Sabotaggi ed Esposizione</h4><p>Potenziare la Minaccia di un altro, aggiungerne una con Movimento laterale o giocare una Sfiga su qualcuno (in qualsiasi momento) è un <b>sabotaggio</b>: +1 Esposizione. A 4 scatta l'<b>audit del SOC</b>: −1 livello e si riparte da zero. L'Ingegnere sociale non lascia tracce.</p>
        <h4>Carte speciali</h4><p>Alcune Interferenze e carte a uso singolo hanno una regola propria, scritta sulla scheda: portano via l'aiutante, annullano un sabotaggio, congelano il combattimento, scaricano la penalità su un altro o gli passano l'intero ticket. Quelle giocate contro un altro sono sabotaggi. Alcune penalità fanno <b>saltare il turno</b>: il segnalino resta accanto al nome finché non lo sconti.</p>
        <h4>Asset e credito</h4><p>Uno slot per tipo: Hardware, Software, Credenziali, Gadget. Puoi equipaggiarti, cambiare ruolo e vendere in qualsiasi momento, ma mai durante un combattimento. Vendendo asset accumuli credito: ogni 1000 è +1 livello.</p>
        <h4>Ruoli</h4><ul>${Object.values(ROLES).map(r => `<li><b>${r.name}</b>: ${r.text}</li>`).join('')}</ul>
        <h4>Tempi e disconnessioni</h4><p>Ogni decisione ha un tempo massimo: allo scadere il server passa, chiude il turno o tira la fuga al posto tuo. Se perdi la connessione hai 15 secondi per rientrare, poi le tue mosse diventano automatiche finché non torni.</p>`}</div>`
    });
  }

  /* ================= come si gioca: 3 schede scorrevoli ================= */
  // Array statico: test/art.js lo valuta. Titolo e frase d'apertura di ogni scheda; il corpo è in tutBody.
  const TUT = [
    ["Obiettivo e turno", "Da livello 1 a livello 10, root: vince chi ci arriva per primo. L'ultimo livello si prende solo battendo una Minaccia."],
    ["Combattimento", "Serve più forza della Minaccia. Il pareggio lo vince solo il Red Teamer."],
    ["Le carte", "Due mazzi. Si parte con 3 Ticket e 2 Asset in mano."]
  ];
  // Le qualifiche dei dieci livelli, come in server/cards.js (test/art.js controlla che coincidano).
  const LADDER = ['guest', 'stagista', 'utente', 'power user', 'helpdesk', 'tecnico', 'senior', 'domain admin', 'enterprise admin', 'root'];
  // Carta d'esempio, non cliccabile: le schede mostrano le stesse carte e gli stessi elementi del tavolo.
  const tcard = (art, type, tag) => `<span class="card k-${type}"><span class="face" data-art="${art}"><img src="/${art.startsWith('back-') ? 'board' : 'cards'}/${art}.jpg" alt=""></span>${tag ? `<span class="tag">${tag}</span>` : ''}</span>`;
  function tutBody(i) {
    if (i === 0) return `<ol class="ladder" aria-label="I dieci livelli">${LADDER.map((t, k) => `<li${k === 9 ? ' class="top"' : ''}><b>${k + 1}</b><small>${t}</small></li>`).join('')}</ol>
      <h5>Il tuo turno</h5>
      <ol class="tsteps">
        <li><span class="tvis">${tcard('gear-hw-laptop-pieno-di-adesivi', 'gear', '+1')}</span><div><b>Preparati</b><p>Equipaggia gli asset, assumi un ruolo, usa le carte livello.</p></div></li>
        <li><span class="tvis">${tcard('back-ticket', 'back')}</span><div><b>Apri un ticket</b><p>Minaccia: la combatti subito. Qualsiasi altra carta va in mano.</p></div></li>
        <li><span class="tvis">${tcard('threat-password-su-un-post-it', 'threat', '1')}</span><div><b>Se non combatti</b><p>Cerca guai con una Minaccia dalla tua mano, oppure analizza i log e pesca una carta coperta.</p></div></li>
        <li><span class="tvis tfan">${tcard('curse-reset-password-obbligatorio', 'curse')}${tcard('oneshot-caffe-della-macchinetta', 'oneshot')}${tcard('role-red', 'role')}</span><div><b>Chiudi il turno</b><p>Massimo 5 carte in mano: scegli tu cosa scartare.</p></div></li>
      </ol>`;
    if (i === 1) return `<div class="tmat">
        <div class="tduel">
          <div class="tside f"><span class="tlab">Tu</span><b class="tpow">7</b><small>livello 4, asset +3</small></div>
          <div class="vs w"><span class="burst" aria-hidden="true">VS</span><b>vince</b></div>
          <div class="tside m"><span class="tlab">Minaccia</span><b class="tpow">6</b><small>forza 6</small></div>
          ${tcard('threat-shadow-it-del-marketing', 'threat', '6')}
        </div>
        <p class="tsum"><b>Tu:</b> livello, asset, carte a uso singolo e chi ti aiuta. <b>Minaccia:</b> forza e interferenze.</p>
      </div>
      <p class="tnote">Prima dell'esito si apre la finestra di interferenza: ognuno gioca una carta o passa.</p>
      <ul class="touts">
        <li><span class="tv">${tcard('back-asset', 'back')}</span><div><span class="tchip win">Vinci</span><p>+1 o +2 livelli e tesori dal mazzo Asset.</p></div></li>
        <li><span class="tv"><span class="die" data-v="5" aria-hidden="true">${'<i></i>'.repeat(9)}</span></span><div><span class="tchip lose">Perdi</span><p>Tiri il dado per fuggire: serve 5 o più, al Sysadmin basta 3. Se fallisci subisci la penalità della Minaccia. Con un Rollback scappi senza tirare.</p></div></li>
        <li><span class="tv"><span class="ava" data-seat="0" aria-hidden="true">TU</span><span class="ava" data-seat="1" aria-hidden="true">+</span></span><div><span class="tchip help">Aiuto</span><p>Offri una parte dei tesori: l'altro può accettare, rifiutare o rilanciare. Chi ti aiuta somma la sua forza, ma non sale di livello.</p></div></li>
        <li><span class="tv"><span class="esp" aria-hidden="true"><i class="on"></i><i class="on"></i><i class="on"></i><i></i></span></span><div><span class="tchip sab">Sabotaggio</span><p>Potenziare la Minaccia di un altro o giocargli una Sfiga costa 1 punto di Esposizione. A 4 scatta l'audit del SOC: perdi 1 livello.</p></div></li>
      </ul>`;
    const kind = (card, name, text) => `<li>${card}<div><b>${name}</b><p>${text}</p></div></li>`;
    return `<div class="tdecks">
        <section><div class="tdeck">${tcard('back-ticket', 'back')}<h5>Mazzo Ticket</h5></div><ul class="tkinds">
          ${kind(tcard('threat-ransomware-con-assistenza-clienti', 'threat', '11'), 'Minacce', 'Da combattere. Il numero è la loro forza.')}
          ${kind(tcard('curse-reset-password-obbligatorio', 'curse'), 'Sfighe', 'Le giochi sugli altri, quando vuoi.')}
          ${kind(tcard('role-red', 'role'), 'Ruoli', 'Un potere speciale. Uno alla volta.')}
          ${kind(tcard('boost-zero-day-fresco', 'boost', '+10'), 'Interferenze', 'Cambiano un combattimento: forza alla Minaccia, aiutanti portati via, sabotaggi annullati.')}
        </ul></section>
        <section><div class="tdeck">${tcard('back-asset', 'back')}<h5>Mazzo Asset</h5></div><ul class="tkinds">
          ${kind(tcard('gear-hw-laptop-pieno-di-adesivi', 'gear', '+1'), 'Equipaggiamento', 'Un asset per slot: Hardware, Software, Credenziali, Gadget.')}
          ${kind(tcard('oneshot-caffe-della-macchinetta', 'oneshot', '+2'), 'Uso singolo', 'Un bonus o un colpo di mano in combattimento. Il Rollback fa fuggire senza dado.')}
          ${kind(tcard('level-certificazione-appena-presa', 'levelup'), 'Carte livello', '+1 livello, ma non portano a 10.')}
        </ul></section>
      </div>
      <p class="tnote">Finché sei a livello 1 ricevi un Asset a ogni inizio turno. Vendi gli asset per ottenere credito: ogni 1000 vale +1 livello, fino al 9.</p>`;
  }
  const tut = document.createElement('div');
  tut.id = 'tut'; tut.className = 'hidden';
  tut.innerHTML = `<div class="tbox" role="dialog" aria-modal="true" aria-labelledby="tutT" tabindex="-1">
    <div class="thead"><h3 id="tutT">Come si gioca</h3><button type="button" class="btn ghost" data-t="skip">Salta</button></div>
    <div class="ttrack">${TUT.map(([t, lead], i) => `<section class="tslide" aria-label="Scheda ${i + 1} di ${TUT.length}: ${esc(t)}"><div class="tslide-in"><h4>${esc(t)}</h4><p class="tlead">${esc(lead)}</p>${tutBody(i)}</div></section>`).join('')}</div>
    <div class="tfoot"><button type="button" class="btn" data-t="prev">← Indietro</button>
      <span class="tdots">${TUT.map((t, i) => `<button type="button" data-t="${i}" aria-label="Scheda ${i + 1}: ${t[0]}"></button>`).join('')}</span>
      <button type="button" class="btn primary" data-t="next">Avanti →</button>
      <label class="toff"><input type="checkbox"> Non mostrare più all'inizio della partita</label></div></div>`;
  document.body.appendChild(tut);
  const track = tut.querySelector('.ttrack');
  const tutAt = () => Math.round(track.scrollLeft / (track.clientWidth || 1));
  const tutGo = i => track.scrollTo({ left: Math.max(0, Math.min(TUT.length - 1, i)) * track.clientWidth });
  function tutSync() {
    const i = tutAt();
    tut.querySelectorAll('.tdots button').forEach((d, k) => k === i ? d.setAttribute('aria-current', 'step') : d.removeAttribute('aria-current'));
    tut.querySelector('[data-t="prev"]').disabled = i === 0;
    tut.querySelector('[data-t="next"]').textContent = i === TUT.length - 1 ? 'Gioca' : 'Avanti →';
  }
  function openTut() {
    if (tut.classList.contains('hidden')) S.tutBack = document.activeElement;
    hidePeek();
    tut.querySelector('.toff input').checked = !!store.get('esc-tut-off');
    tut.classList.remove('hidden'); $('#app').inert = true;
    track.scrollTo({ left: 0, behavior: 'instant' }); tutSync(); tut.querySelector('.tbox').focus();
  }
  function closeTut() {
    const wasOpen = !tut.classList.contains('hidden');
    tut.classList.add('hidden'); $('#app').inert = false;
    const back = S.tutBack; S.tutBack = null;
    if (back && typeof back.focus === 'function') try { back.focus(); } catch (e) { /* ignore */ }
    if (wasOpen && S.view && S.room && S.room.started && !S.view.over) send({ t: 'tutDone' });
  }
  track.addEventListener('scroll', tutSync, { passive: true });
  tut.addEventListener('change', e => store.set('esc-tut-off', e.target.checked));
  tut.addEventListener('click', e => {
    e.stopPropagation();
    const b = e.target.closest('[data-t]');
    if (!b) { if (e.target === tut) closeTut(); return; }
    const t = b.dataset.t, i = tutAt();
    if (t === 'skip' || (t === 'next' && i === TUT.length - 1)) closeTut();
    else tutGo(t === 'prev' ? i - 1 : t === 'next' ? i + 1 : +t);
  });

  /* ================= anteprima al passaggio del mouse ================= */
  const peek = document.createElement('div');
  peek.id = 'peek'; peek.className = 'hidden'; peek.setAttribute('aria-hidden', 'true');
  document.body.appendChild(peek);
  const hidePeek = () => { peek.classList.add('hidden'); peek._uid = null; peek._el = null; };
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.addEventListener('mouseover', e => {
      const el = !S.modal && S.view && S.room && S.room.started && e.target.closest('.card[data-uid], .slot.full');
      const c = el && (el.dataset.uid ? (V().hand.find(x => x.uid === +el.dataset.uid) || findPublic(+el.dataset.uid)) : el.dataset.role ? ME().role : ME().gear[el.dataset.slot]);
      if (!c) return hidePeek();
      if (peek._uid === c.uid) return;
      peek._uid = c.uid; peek._el = el;
      peek.innerHTML = `${faceHTML(c)}<div><b>${esc(c.name)}</b>${fxHTML(c)}</div>`;
      peek.classList.remove('hidden');
      const r = el.getBoundingClientRect(), w = peek.offsetWidth, h = peek.offsetHeight;
      const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
      // sopra la carta se c'è posto (lasciando spazio al sollevamento della mano), altrimenti sotto
      const lift = el.closest('.hand') ? 64 : 14;
      const y = r.top - h - lift > 8 ? r.top - h - lift : Math.min(r.bottom + 14, innerHeight - h - 8);
      peek.style.left = x + 'px'; peek.style.top = y + 'px';
    });
  }

  /* ================= eventi ================= */
  // Tornato in fondo al registro a mano: l'avviso «Nuovi eventi» non serve più.
  document.addEventListener('scroll', e => {
    const t = e.target;
    if (S.logNew && t && t.id === 'log' && logGap(t) < 48) { S.logNew = false; render(); }
  }, true);
  document.addEventListener('input', e => {
    const f = e.target.dataset && e.target.dataset.f;
    if (!f) return;
    S.form[f] = f === 'code' ? e.target.value.toUpperCase() : e.target.value;
    if (f === 'name') store.set('esc-name', e.target.value);
  });
  document.addEventListener('change', e => {
    const id = e.target.dataset && e.target.dataset.botid;
    if (id) send({ t: 'renameBot', id, name: e.target.value });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && S.modal && S.modal.dismiss) { closeModal(); return; }
    if (!S.modal && !tut.classList.contains('hidden')) {
      if (e.key === 'Escape') closeTut();
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); tutGo(tutAt() + (e.key === 'ArrowRight' ? 1 : -1)); }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (e.target && e.target.id === 'log') { e.preventDefault(); S.logOpen = !S.logOpen; render(); return; }
      if (e.target && e.target.classList && e.target.classList.contains('opp') && !S.modal) { e.preventDefault(); openOppModal(e.target.dataset.pid); return; }
    }
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.botid) { e.target.blur(); return; }
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
      case 'logEnd': { const log = $('#log'); S.logNew = false; if (log) { log._k = null; } return render(); }
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
      case 'addBot': {
        const el = document.querySelector('#fBot');
        const name = el ? el.value : (S.room && S.room.nextBot) || '';
        S.form.bot = null;
        return send({ t: 'addBot', name });
      }
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
      case 'offer': return openOfferModal();
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
      if (el.classList.contains('hud-cd')) el.classList.toggle('urgent', left < 15000);
    });
  }, 1000);

  render();
  connect();
})();
