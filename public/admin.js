'use strict';
// Pannello admin: lista stanze, chiusura forzata, snapshot config. Auth via ADMIN_TOKEN.
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  let token = store.get('esc-admin-token') || '';
  let data = null;
  let err = '';

  async function api(path) {
    const u = path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
    const res = await fetch(u);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    return body;
  }

  async function refresh() {
    err = '';
    try {
      data = await api('/admin/api/rooms');
      store.set('esc-admin-token', token);
    } catch (e) {
      data = null; err = e.message;
    }
    render();
  }

  async function closeRoom(code) {
    if (!confirm('Chiudere la stanza ' + code + '?')) return;
    try {
      await api('/admin/api/close?code=' + encodeURIComponent(code));
      await refresh();
    } catch (e) { err = e.message; render(); }
  }

  function ago(ts) {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    return Math.floor(s / 3600) + 'h';
  }

  function render() {
    const scr = $('#screen');
    if (!token || !data) {
      scr.innerHTML = `<section class="panel">
        <h2>Accesso admin</h2>
        <p class="lead">Inserisci il token impostato in <code>ADMIN_TOKEN</code> sul server. Senza token l'API è chiusa.</p>
        <div class="field"><label for="tok">Token</label><input id="tok" type="password" autocomplete="current-password" value="${esc(token)}"></div>
        ${err ? `<p class="hint r">${esc(err)}</p>` : ''}
        <button class="btn primary" type="button" id="login">Entra</button>
      </section>`;
      $('#login').onclick = () => { token = ($('#tok').value || '').trim(); refresh(); };
      $('#tok').onkeydown = e => { if (e.key === 'Enter') $('#login').click(); };
      return;
    }
    const cfg = data.config;
    const rows = data.rooms.map(r => `<tr>
      <td><code>${esc(r.code)}</code></td>
      <td>${r.started ? (r.over ? 'finita' : 'in corso') : 'lobby'}</td>
      <td>${r.humans}u + ${r.bots}b / ${r.members}</td>
      <td>${ago(r.lastActive)}</td>
      <td><button type="button" class="xbtn" data-close="${esc(r.code)}">Chiudi</button></td>
    </tr>`).join('') || '<tr><td colspan="5">Nessuna stanza aperta.</td></tr>';

    scr.innerHTML = `<section class="panel">
        <div class="row admin-head">
          <h2>Stanze live (${data.rooms.length})</h2>
          <div class="row">
            <button class="btn" type="button" id="reload">Aggiorna</button>
            <button class="btn ghost" type="button" id="logout">Esci</button>
          </div>
        </div>
        <div class="admin-table-wrap"><table class="admin-table"><thead>
          <tr><th>Codice</th><th>Stato</th><th>Giocatori</th><th>Attività</th><th></th></tr>
        </thead><tbody>${rows}</tbody></table></div>
      </section>
      <section class="panel">
        <h2>Config server</h2>
        <ul class="admin-cfg">
          <li>Stanze max: <b>${cfg.maxRooms}</b> · giocatori ${cfg.minPlayers}–${cfg.maxPlayers}</li>
          <li>BOT_DELAY ${cfg.botDelay}ms · TIMEOUT_SCALE ${cfg.timeoutScale} · grace ${cfg.graceMs}ms</li>
          <li>ROOM_MAX_MS ${cfg.roomMaxMs}</li>
        </ul>
      </section>`;

    $('#reload').onclick = refresh;
    $('#logout').onclick = () => { token = ''; store.del('esc-admin-token'); data = null; render(); };
    scr.querySelectorAll('[data-close]').forEach(btn => {
      btn.onclick = () => closeRoom(btn.dataset.close);
    });
  }

  render();
  if (token) refresh();
  setInterval(() => { if (token && data) refresh(); }, 15000);
})();
