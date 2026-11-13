#!/usr/bin/env python3
"""Compone le carte di ESCALATION: art/illustrations/<slug>.jpg + art/card-faces.json -> art/cards/<slug>.jpg

Il telaio (cornice, stelle, barra del nome, riquadro del testo) e i testi li disegna questo script:
per cambiare il nome o la battuta di una carta basta modificare art/card-faces.json e rilanciarlo.
Colore e stelle vengono da art/cards-manifest.json (node art/build-manifest.js).

Uso: python3 art/build-cards.py [slug ...]      poi: python3 art/build-frames.py
Richiede Pillow (con libraqm per il font variabile) e numpy.
"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(ROOT, 'fonts', 'Archivo.ttf')
S = 2                                   # disegno a risoluzione doppia, poi riduzione: bordi puliti
W, H = 864, 1152
FRAME = (57, 34, 808, 1112, 46)          # cornice nera: x0, y0, x1, y1, raggio
ART = (88, 68, 779, 654, 18)             # riquadro del disegno
NAME = (88, 687, 779, 796, 16)           # barra del nome
TEXT = (88, 820, 779, 1080, 16)          # riquadro della battuta
INK = (14, 12, 17)
STAR_ON, STAR_ON_DARK, STAR_OFF = (255, 205, 46), (214, 140, 10), (96, 96, 106)
# colore della barra (alto, basso) e del riquadro (alto, basso) per famiglia di carta
PALETTE = {
    'red':    ((204, 22, 28), (140, 10, 16), (196, 20, 26), (104, 8, 12)),
    'purple': ((106, 34, 158), (68, 23, 116), (98, 32, 150), (48, 16, 84)),
    'blue':   ((16, 132, 226), (4, 88, 180), (12, 122, 216), (2, 58, 136)),
    'gold':   ((232, 146, 10), (176, 96, 4), (214, 128, 10), (122, 68, 4)),
}


def font(size, wght, wdth):
    f = ImageFont.truetype(FONT, int(size * S))
    f.set_variation_by_axes([wght, wdth])   # assi del file: peso, larghezza
    return f


def sc(box):
    return tuple(int(round(v * S)) for v in box)


def gradient(size, top, bottom):
    w, h = size
    t = np.linspace(0, 1, h)[:, None, None]
    arr = (np.array(top)[None, None, :] * (1 - t) + np.array(bottom)[None, None, :] * t)
    return Image.fromarray(np.repeat(arr, w, 1).astype('uint8'), 'RGB')


def rounded_mask(size, r):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=r, fill=255)
    return m


def panel(card, box, top, bottom, gloss=True):
    x0, y0, x1, y1, r = sc(box)
    g = gradient((x1 - x0, y1 - y0), top, bottom)
    if gloss:   # riflesso morbido in alto, come una barra smaltata
        d = ImageDraw.Draw(g, 'RGBA')
        d.rounded_rectangle((6 * S, 4 * S, g.width - 6 * S, int(g.height * 0.42)), radius=r, fill=(255, 255, 255, 26))
    card.paste(g, (x0, y0), rounded_mask(g.size, r))


def star(d, cx, cy, r, fill, edge):
    pts = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        rr = r if i % 2 == 0 else r * 0.47
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    d.polygon(pts, fill=fill, outline=edge, width=int(2.5 * S))


def fit_lines(d, lines, maxw, maxh, sizes, wght, wdth, lead, squeeze_first):
    """Trova la dimensione più grande che entra. I titoli prima stringono le lettere e poi rimpiccioliscono;
    la battuta prima rimpicciolisce e stringe le lettere solo se non basta."""
    tries = ([(z, w) for z in sizes for w in (wdth, wdth - 15, wdth - 28)] if squeeze_first
             else [(z, w) for w in (wdth, wdth - 15, wdth - 28) for z in sizes])
    for size, w in tries:
        f = font(size, wght, w)
        if all(d.textlength(l, font=f) <= maxw for l in lines) and len(lines) * size * S * lead <= maxh:
            return f, size
    return f, size


def shadow_text(card, xy, text, f, fill=(255, 255, 255)):
    x, y = xy
    sh = Image.new('L', card.size, 0)
    ImageDraw.Draw(sh).text((x, y + 3 * S), text, font=f, fill=150)
    sh = sh.filter(ImageFilter.GaussianBlur(2 * S))
    card.paste((0, 0, 0), (0, 0), sh)
    ImageDraw.Draw(card).text((x, y), text, font=f, fill=fill)


def centered(card, box, lines, f, size, lead):
    x0, y0, x1, y1, _ = sc(box)
    d = ImageDraw.Draw(card)
    lh = size * S * lead
    asc, desc = f.getmetrics()
    y = (y0 + y1) / 2 - lh * len(lines) / 2 + (lh - (asc + desc)) / 2 + desc * 0.35
    for l in lines:
        shadow_text(card, ((x0 + x1) / 2 - d.textlength(l, font=f) / 2, y), l, f)
        y += lh


def cover(img, size):
    w, h = size
    s = max(w / img.width, h / img.height)
    img = img.resize((math.ceil(img.width * s), math.ceil(img.height * s)), Image.LANCZOS)
    l, t = (img.width - w) // 2, (img.height - h) // 2
    return img.crop((l, t, l + w, t + h))


def build(slug, face, meta):
    top, bottom, ttop, tbottom = PALETTE[meta['color']]
    card = Image.new('RGB', (W * S, H * S), (255, 255, 255))
    d = ImageDraw.Draw(card)
    x0, y0, x1, y1, r = sc(FRAME)
    d.rounded_rectangle((x0, y0, x1, y1), radius=r, fill=INK)
    # disegno
    ax0, ay0, ax1, ay1, ar = sc(ART)
    art = cover(Image.open(os.path.join(ROOT, 'illustrations', slug + '.jpg')).convert('RGB'), (ax1 - ax0, ay1 - ay0))
    card.paste(art, (ax0, ay0), rounded_mask(art.size, ar))
    # linguetta delle stelle, che morde il fondo del disegno
    cx, ty, by = W * S / 2, (ART[3] - 30) * S, (NAME[1] - 2) * S
    d.rounded_rectangle((cx - 178 * S, ty, cx + 178 * S, by), radius=22 * S, fill=INK)
    for i in range(5):
        on = i < meta['stars']
        star(d, cx + (i - 2) * 64 * S, (ART[3] + 3) * S, 21 * S, STAR_ON if on else STAR_OFF, STAR_ON_DARK if on else (70, 70, 78))
    # nome
    panel(card, NAME, top, bottom, gloss=False)
    title = face['title'].upper()
    nx0, ny0, nx1, ny1, _ = sc(NAME)
    f, size = fit_lines(d, [title], nx1 - nx0 - 56 * S, ny1 - ny0, [66, 62, 58, 54, 50, 46, 42, 38], 900, 100, 1.0, True)
    centered(card, NAME, [title], f, size, 1.0)
    # battuta
    panel(card, TEXT, ttop, tbottom, gloss=False)
    lines = face['text'].split('\n')
    tx0, ty0, tx1, ty1, _ = sc(TEXT)
    f, size = fit_lines(d, lines, tx1 - tx0 - 48 * S, ty1 - ty0 - 60 * S, [48, 46, 44, 42, 40, 38, 36], 850, 100, 1.18, False)
    centered(card, TEXT, lines, f, size, 1.18)
    card.resize((W, H), Image.LANCZOS).save(os.path.join(ROOT, 'cards', slug + '.jpg'), quality=90, optimize=True)
    return size


def main():
    faces = json.load(open(os.path.join(ROOT, 'card-faces.json'), encoding='utf-8'))
    meta = {c['slug']: c for c in json.load(open(os.path.join(ROOT, 'cards-manifest.json'), encoding='utf-8'))}
    only = sys.argv[1:]
    missing = [s for s in meta if s not in faces or not os.path.exists(os.path.join(ROOT, 'illustrations', s + '.jpg'))]
    if missing:
        sys.exit('mancano testo o disegno per: ' + ', '.join(missing))
    for slug in (only or meta):
        size = build(slug, faces[slug], meta[slug])
        if size < 40:
            print(f'testo lungo, stampato piccolo ({size}px): {slug}')
    print(len(only or meta), 'carte')


if __name__ == '__main__':
    main()
