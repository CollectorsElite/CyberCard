'use strict';
// Ogni carta del mazzo deve avere la sua illustrazione, con lo stesso slug che usa il client.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { buildDecks, QUIPS } = require('../server/cards');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'public', 'client.js'), 'utf8');
const m = src.match(/function artSlug\(c\) \{[\s\S]*?\n  \}/);
assert(m, 'artSlug non trovato in client.js');
const artSlug = new Function(m[0] + '; return artSlug;')();

let id = 0;
const { T, A } = buildDecks(() => ++id, x => x);
const missing = [...new Set([...T, ...A].map(artSlug))].filter(s => !fs.existsSync(path.join(root, 'art', 'cards', s + '.jpg')));
assert.deepStrictEqual(missing, [], 'illustrazioni mancanti: ' + missing.join(', '));

// Battute dei fumetti: ogni carta da sabotaggio e ogni effetto di minaccia ha la sua.
const keys = [...T, ...A].flatMap(c => c.type === 'threat' ? ['fleeKo:' + (c.bad[0].s || c.bad[0].k)]
  : (c.type === 'oneshot' && !c.escape) || c.type === 'lateral' || (c.type === 'boost' && c.amt > 0) ? ['sabotage:' + c.name] : []);
const noQuip = [...new Set(keys)].filter(k => !QUIPS[k]);
assert.deepStrictEqual(noQuip, [], 'battute mancanti: ' + noQuip.join(', '));
for (const q of Object.values(QUIPS).flat()) assert(!/^«|»$/.test(q), 'il fumetto taglierebbe le virgolette: ' + q);

const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
for (const d of ['art/cards', 'art/board']) assert(docker.includes(`COPY ${d} `), `il Dockerfile non copia ${d}: in produzione le immagini sarebbero 404`);
for (const f of ['felt', 'back-ticket', 'back-asset', 'logo', 'tut-1', 'tut-2', 'tut-3', 'desk', 'room']) assert(fs.existsSync(path.join(root, 'art', 'board', f + '.jpg')), 'manca art/board/' + f + '.jpg');

// La CSP (style-src 'self') blocca gli attributi style inline: il browser li ignora in silenzio.
for (const f of ['index.html', 'client.js', 'admin.html', 'admin.js']) {
  assert(!/style=/.test(fs.readFileSync(path.join(root, 'public', f), 'utf8')), `style inline in public/${f}`);
}

// Tutorial pre-partita: esattamente 3 schede, opt-out salvato, miniature che esistono davvero.
const tm = src.match(/const TUT = \[[\s\S]*?\n  \];/);
assert(tm, 'TUT non trovato in client.js');
const TUT = new Function(tm[0] + '; return TUT;')();
assert.strictEqual(TUT.length, 3, 'il tutorial deve avere esattamente 3 schede');
assert(src.includes("store.get('esc-tut-off')") && src.includes("store.set('esc-tut-off'"), 'opt-out del tutorial non salvato');
assert(src.includes('data-botid'), 'nome bot in linea assente');
assert(src.includes('class="hud'), 'HUD combattimento assente');
const css = fs.readFileSync(path.join(root, 'public', 'style.css'), 'utf8');
assert(css.includes('/board/desk.jpg') && css.includes('/board/felt.jpg'), 'texture plancia mancanti nello CSS');

// Ritaglio delle illustrazioni: ogni carta (e i due dorsi) ha la sua regola in cards.css, generata da art/build-frames.py.
const frames = fs.readFileSync(path.join(root, 'public', 'cards.css'), 'utf8');
const noFrame = [...new Set([...T, ...A].map(artSlug)), 'back-ticket', 'back-asset'].filter(s => !frames.includes(`[data-art="${s}"]{`));
assert.deepStrictEqual(noFrame, [], 'ritagli mancanti in public/cards.css (rilancia art/build-frames.py): ' + noFrame.join(', '));
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
assert(html.includes('href="/cards.css"'), 'index.html non carica /cards.css');
// Il font è servito da noi (la CSP non ammette origini esterne) e deve esistere davvero.
assert(css.includes("url('/fonts/archivo.woff2')") && fs.existsSync(path.join(root, 'public', 'fonts', 'archivo.woff2')), 'font Archivo mancante');
const srv = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
for (const u of ["'/cards.css'", "'/fonts/archivo.woff2'"]) assert(srv.includes(u), `il server non serve ${u}`);

// Le schede sono HTML: titolo e frase d'apertura in TUT, il corpo in tutBody con carte vere d'esempio.
for (const row of TUT) assert(row.length === 2 && row.every(x => typeof x === 'string' && x.trim()), 'scheda del tutorial senza titolo o testo');
const tb = src.match(/function tutBody\(i\) \{[\s\S]*?\n  \}/);
assert(tb, 'tutBody non trovato in client.js');
const tutArt = [...tb[0].matchAll(/tcard\('([a-z0-9-]+)'/g)].map(m => m[1]);
assert(tutArt.length >= 10, 'il tutorial non mostra carte');
const tutMissing = [...new Set(tutArt)].filter(a => !fs.existsSync(path.join(root, 'art', a.startsWith('back-') ? 'board' : 'cards', a + '.jpg')) || !frames.includes(`[data-art="${a}"]{`));
assert.deepStrictEqual(tutMissing, [], 'carte del tutorial senza illustrazione o ritaglio: ' + tutMissing.join(', '));
const lm = src.match(/const LADDER = (\[[^\]]*\]);/);
assert(lm, 'LADDER non trovato in client.js');
assert.deepStrictEqual(new Function('return ' + lm[1])(), require('../server/cards').TITLES.slice(1), 'le qualifiche del tutorial non coincidono con server/cards.js');

// I testi dei ruoli sono ripetuti nel client: devono coincidere con quelli del server.
const rm = src.match(/const ROLES = (\{[\s\S]*?\n  \});/);
assert(rm, 'ROLES non trovato in client.js');
assert.deepStrictEqual(new Function('return ' + rm[1])(), require('../server/cards').ROLES, 'ruoli del client diversi da server/cards.js');

console.log(`OK art (${T.length + A.length} carte)`);
