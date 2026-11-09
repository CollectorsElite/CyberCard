'use strict';
// Ogni carta del mazzo deve avere la sua illustrazione, con lo stesso slug che usa il client.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { buildDecks } = require('../server/cards');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'public', 'client.js'), 'utf8');
const m = src.match(/function artSlug\(c\) \{[\s\S]*?\n  \}/);
assert(m, 'artSlug non trovato in client.js');
const artSlug = new Function(m[0] + '; return artSlug;')();

let id = 0;
const { T, A } = buildDecks(() => ++id, x => x);
const missing = [...new Set([...T, ...A].map(artSlug))].filter(s => !fs.existsSync(path.join(root, 'art', 'cards', s + '.jpg')));
assert.deepStrictEqual(missing, [], 'illustrazioni mancanti: ' + missing.join(', '));

const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
for (const d of ['art/cards', 'art/board']) assert(docker.includes(`COPY ${d} `), `il Dockerfile non copia ${d}: in produzione le immagini sarebbero 404`);
for (const f of ['felt', 'back-ticket', 'back-asset']) assert(fs.existsSync(path.join(root, 'art', 'board', f + '.jpg')), 'manca art/board/' + f + '.jpg');

// La CSP (style-src 'self') blocca gli attributi style inline: il browser li ignora in silenzio.
for (const f of ['index.html', 'client.js', 'admin.html', 'admin.js']) {
  assert(!/style=/.test(fs.readFileSync(path.join(root, 'public', f), 'utf8')), `style inline in public/${f}`);
}

console.log(`OK art (${T.length + A.length} carte)`);
