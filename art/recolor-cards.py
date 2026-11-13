#!/usr/bin/env python3
"""Porta nel gioco le carte originali (PNG, tutte con barra e riquadro viola) ricolorandole per famiglia.

Cambia tinta solo ai pixel viola di barra del nome e riquadro del testo, nella parte bassa della carta:
disegno, stelle, etichetta del tipo, testi e cornice restano identici; luci, sfumature e grana restano.
Colori (da art/cards-manifest.json): rosso Minacce, viola Sfighe, verde Interferenze,
blu Ruoli e carte a uso singolo, oro Asset e carte livello.

Uso:  python3 art/recolor-cards.py <cartella con i PNG originali>
      poi: python3 art/build-frames.py && npm test
I PNG si abbinano alle carte per nome del file (es. 038-Zero-day-del-venerdi-alle-17-59.png).
Richiede Pillow e numpy.
"""
import json, os, re, sys, unicodedata
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
TARGET = {            # tinta (gradi), schiarimento, saturazione
    'red':    (356, 1.40, 1.00),
    'blue':   (212, 1.35, 1.00),
    'gold':   (34,  1.75, 1.00),
    'green':  (146, 1.30, 0.95),
    'purple': None,   # già del colore giusto
}


def rgb2hsv(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(-1), a.min(-1); d = mx - mn
    h = np.zeros_like(mx); nz = d > 1e-6
    rm = nz & (mx == r); gm = nz & (mx == g) & ~rm; bm = nz & ~rm & ~gm
    h[rm] = ((g - b)[rm] / d[rm]) % 6
    h[gm] = (b - r)[gm] / d[gm] + 2
    h[bm] = (r - g)[bm] / d[bm] + 4
    return h * 60, np.where(mx > 0, d / np.maximum(mx, 1e-6), 0), mx


def hsv2rgb(h, s, v):
    c = v * s; x = c * (1 - np.abs((h / 60) % 2 - 1)); m = v - c
    z = np.zeros_like(h); k = (h // 60).astype(int) % 6
    sel = lambda *vals: np.select([k == i for i in range(6)], vals)
    return np.stack([sel(c, x, z, z, x, c) + m, sel(x, c, c, x, z, z) + m, sel(z, z, x, c, c, x) + m], -1)


def recolor(img, color, y0=0.565, y1=0.975):
    t = TARGET[color]
    if t is None:
        return img.convert('RGB')
    hue, kv, ks = t
    a = np.asarray(img.convert('RGB')).astype(float) / 255
    H, W, _ = a.shape
    h, s, v = rgb2hsv(a)
    zone = np.zeros((H, W), bool); zone[int(H * y0):int(H * y1), 22:W - 22] = True
    purple = (h > 228) & (h < 312) & (s > 0.06) & (v > 0.11)          # la cornice quasi nera resta com'è
    wgt = np.clip((s - 0.06) / 0.12, 0, 1) * np.clip((v - 0.11) / 0.06, 0, 1) * (zone & purple)
    g = 1 + (kv - 1) * wgt
    nv = np.clip(v * g / (1 + (g - 1) * v), 0, 1)                      # schiarisce gli scuri più dei chiari
    ns = np.clip(s * (1 + (ks - 1) * wgt), 0, 1)
    out = hsv2rgb(np.where(wgt > 0, hue, h), ns, nv)
    out = a * (1 - wgt[..., None]) + out * wgt[..., None]
    return Image.fromarray((np.clip(out, 0, 1) * 255).round().astype('uint8'))


def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '', s)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    files = {}
    for dirpath, _, names in os.walk(src):
        for n in names:
            if n.lower().endswith('.png'):
                files[norm(re.sub(r'^\d+-', '', n[:-4]))] = os.path.join(dirpath, n)
    cards = json.load(open(os.path.join(ROOT, 'cards-manifest.json'), encoding='utf-8'))
    missing = [c['name'] for c in cards if norm(c['name']) not in files]
    if missing:
        sys.exit('manca il PNG per: ' + ', '.join(missing))
    for c in cards:
        recolor(Image.open(files[norm(c['name'])]), c['color']).save(
            os.path.join(ROOT, 'cards', c['slug'] + '.jpg'), quality=88, optimize=True)
    print(len(cards), 'carte')


if __name__ == '__main__':
    main()
