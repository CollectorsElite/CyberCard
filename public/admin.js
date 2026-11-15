'use strict';
// Pannello admin: partite in corso con giocatori e stato, altre stanze in fondo, chiusura forzata.
// Il token (ADMIN_TOKEN sul server) viaggia solo nell'intestazione X-Admin-Token.
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  const REFRESH_MS = 10000;
  const ESP_MAX = 4;
  const PHASES = { open: 'apre il ticket', combat: 'combatte', after: 'dopo il ticket', end: 'fine turno', over: 'partita finita' };
  const STEPS = { prep: 'preparazione', window: 'finestra aperta', flee: 'fuga' };

  let token = store.get('esc-admin-token') || '';
  let data = null, err = '', at = 0, skew = 0;

  async function api(path, method = 'GET') {
    const res = await fetch(path, { method, headers: { 'X-Admin-Token': token }, cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(res.status === 401 ? 'Token sbagliato.' : res.status === 404 && /disabilitato/.test(body.error || '') ? 'Pannello spento: sul server manca la variabile ADMIN_TOKEN.' : (body.error || 'Errore ' + res.status));
      e.status = res.status; throw e;
    }
    return body;
  }

  async function refresh() {
    try {
      data = await api('/admin/api/rooms');
      skew = data.now - Date.now(); at = Date.now(); err = '';
      store.set('esc-admin-token', token);
    } catch (e) {
      err = e.message;
      if (e.status === 401 || e.status === 404) { data = null; store.del('esc-admin-token'); }
    }
    render();
  }

  async function closeRoom(code) {
    if (!confirm(`Chiudere la stanza ${code}? Chi sta giocando torna alla schermata iniziale.`)) return;
    try { await api('/admin/api/close?code=' + encodeURIComponent(code), 'POST'); } catch (e) { err = e.message; }
    await refresh();
  }

  const now = () => Date.now() + skew;
  function dur(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
  }
  const STATUS = { connesso: 'on', disconnesso: 'off', uscito: 'gone', bot: 'bot' };
  const statusTag = s => `<span class="adm-st adm-st-${STATUS[s] || 'off'}">${esc(s)}</span>`;

  function situation(g) {
    if (g.winner) return `Ha vinto <b>${esc(g.winner)}</b>`;
    const c = g.combat;
    if (!c) return `Turno di <b>${esc(g.cur)}</b>, ${esc(PHASES[g.phase] || g.phase)}`;
    const who = esc(c.fighter) + (c.helper ? ' con ' + esc(c.helper) : '');
    const ahead = c.fighterPower > c.threatPower;
    return `<b>${who}</b> contro ${esc(c.threats.join(' + '))}: <span class="${ahead ? 'adm-up' : 'adm-down'}">${c.fighterPower} a ${c.threatPower}</span> (${esc(STEPS[c.step] || c.step)})`;
  }

  function gameHTML(r) {
    const g = r.game;
    const top = Math.max(...g.players.map(p => p.level));
    const rows = [...g.players].sort((a, b) => b.level - a.level || b.power - a.power).map(p => `<tr${p.level === top ? ' class="adm-lead"' : ''}>
        <td>${esc(p.name)}${p.level === top ? ' <span class="adm-crown">in testa</span>' : ''}</td>
        <td class="num">${p.level}</td>
        <td class="num">${p.power}</td>
        <td class="num${p.esp >= ESP_MAX - 1 ? ' adm-down' : ''}">${p.esp}/${ESP_MAX}</td>
        <td class="adm-opt">${esc(p.role || '-')}</td>
        <td class="num adm-opt">${p.handCount}</td>
        <td>${statusTag(p.status)}</td>
      </tr>`).join('');
    const left = r.closesAt - now();
    return `<section class="panel adm-game">
      <div class="adm-gh">
        <div>
          <h3><code>${esc(r.code)}</code> <span class="adm-turn">giro ${g.turn}</span></h3>
          <p class="adm-sit">${situation(g)}</p>
        </div>
        <button type="button" class="btn ghost" data-close="${esc(r.code)}">Chiudi</button>
      </div>
      <p class="adm-time">${now() - r.startedAt < 60000 ? 'Appena iniziata' : 'Iniziata da ' + dur(now() - r.startedAt)}, si chiude da sola tra ${dur(left)}${left < 10 * 60000 ? ' <b class="adm-down">(presto)</b>' : ''}</p>
      <div class="admin-table-wrap"><table class="admin-table">
        <thead><tr><th>Giocatore</th><th class="num"><abbr title="Livello">Liv.</abbr></th><th class="num">Forza</th><th class="num"><abbr title="Esposizione">Esp.</abbr></th><th class="adm-opt">Ruolo</th><th class="num adm-opt">Carte</th><th>Stato</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>`;
  }

  function otherHTML(rooms) {
    if (!rooms.length) return '';
    const rows = rooms.map(r => {
      const humans = r.members.filter(m => !m.isBot);
      const what = r.state === 'finita' ? `finita, ha vinto ${esc(r.game.winner || '?')}` : 'lobby';
      return `<tr>
        <td><code>${esc(r.code)}</code></td>
        <td>${what}</td>
        <td>${esc(r.members.map(m => m.name).join(', '))}</td>
        <td>${humans.filter(m => m.status === 'connesso').length} su ${humans.length} connessi</td>
        <td class="adm-opt">${now() - r.lastActive < 60000 ? 'attiva ora' : 'attiva ' + dur(now() - r.lastActive) + ' fa'}</td>
        <td><button type="button" class="xbtn" data-close="${esc(r.code)}">Chiudi</button></td>
      </tr>`;
    }).join('');
    return `<section class="panel">
      <h2>Altre stanze (${rooms.length})</h2>
      <div class="admin-table-wrap"><table class="admin-table"><tbody>${rows}</tbody></table></div>
    </section>`;
  }

  function render() {
    const scr = $('#screen');
    if (!data) {
      scr.innerHTML = `<section class="panel">
        <h2>Accesso admin</h2>
        <p class="lead">Inserisci il token impostato nella variabile <code>ADMIN_TOKEN</code> del server. Il browser lo ricorda finché non premi Esci.</p>
        <div class="field"><label for="tok">Token</label><input id="tok" type="password" autocomplete="current-password" value=""></div>
        ${err ? `<p class="hint r">${esc(err)}</p>` : ''}
        <button class="btn primary" type="button" id="login">Entra</button>
      </section>`;
      $('#login').onclick = () => { token = ($('#tok').value || '').trim(); if (token) refresh(); };
      $('#tok').onkeydown = e => { if (e.key === 'Enter') $('#login').click(); };
      $('#tok').focus();
      return;
    }
    const live = data.rooms.filter(r => r.state === 'in corso').sort((a, b) => a.startedAt - b.startedAt);
    const other = data.rooms.filter(r => r.state !== 'in corso');
    const t = new Date(at).toLocaleTimeString('it-IT');
    scr.innerHTML = `<section class="panel adm-bar">
        <h2>${live.length ? `Partite in corso: ${live.length}` : 'Nessuna partita in corso'}</h2>
        <span class="adm-at">aggiornato alle ${t}${err ? ` · <span class="r">${esc(err)}</span>` : ''}</span>
        <button class="btn" type="button" id="reload">Aggiorna</button>
        <button class="btn ghost" type="button" id="logout">Esci</button>
      </section>
      ${live.map(gameHTML).join('')}
      ${otherHTML(other)}`;
    $('#reload').onclick = refresh;
    $('#logout').onclick = () => { token = ''; store.del('esc-admin-token'); data = null; err = ''; render(); };
    scr.querySelectorAll('[data-close]').forEach(btn => { btn.onclick = () => closeRoom(btn.dataset.close); });
  }

  render();
  if (token) refresh();
  setInterval(() => { if (token && data && !document.hidden) refresh(); }, REFRESH_MS);
})();
