'use strict';
const fs = require('fs');
const c = require('../server/cards');
const slug = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
const out = [];
const starThreat = l => (l <= 2 ? 1 : l <= 4 ? 2 : l <= 6 ? 3 : l <= 9 ? 4 : 5);
for (const t of c.THREATS) out.push({ slug: 'threat-' + slug(t.n), color: 'red', name: t.n, text: t.d, stars: starThreat(t.l) });
for (const t of c.CURSES) {
  const hard = t.bad.some(b => b.k === 'role' || b.k === 'best' || (b.k === 'penalty' && b.n >= 3));
  out.push({ slug: 'curse-' + slug(t.n), color: 'purple', name: t.n, text: t.d, stars: hard ? 3 : 2 });
}
for (const [k, r] of Object.entries(c.ROLES)) out.push({ slug: 'role-' + k, color: 'blue', name: r.name, text: r.text, stars: 4 });
for (const b of c.BOOSTS) out.push({ slug: 'boost-' + slug(b.n), color: 'gold', name: b.n, text: b.d, stars: b.amt >= 10 ? 4 : b.amt < 0 ? 2 : 3 });
for (const t of c.TRICKS_T) out.push({ slug: 'trick-' + slug(t[1]), color: 'purple', name: t[1], text: t[3], stars: 3 });
for (const t of c.TRICKS_A) out.push({ slug: 'trick-' + slug(t[1]), color: 'blue', name: t[1], text: t[4], stars: 3 });
out.push({ slug: 'lateral-movimento', color: 'purple', name: 'Movimento laterale', text: "L'attaccante si sposta. Su di te.", stars: 3 });
for (const g of c.GEAR) out.push({ slug: 'gear-' + g[0] + '-' + slug(g[1]), color: 'gold', name: g[1], text: g[4], stars: Math.min(5, Math.max(1, g[2])) });
for (const o of c.ONESHOTS) out.push({ slug: 'oneshot-' + slug(o[0]), color: 'blue', name: o[0], text: o[4], stars: Math.min(5, Math.max(1, o[1] - 1)) });
out.push({ slug: 'oneshot-rollback', color: 'blue', name: 'Rollback', text: 'Torni allo stato di prima. Quasi.', stars: 3 });
for (const l of c.LEVELUPS) out.push({ slug: 'level-' + slug(l[0]), color: 'gold', name: l[0], text: l[1], stars: 3 });
fs.writeFileSync(__dirname + '/cards-manifest.json', JSON.stringify(out, null, 2));
console.log(out.length);
