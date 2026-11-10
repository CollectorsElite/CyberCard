#!/usr/bin/env python3
"""Genera public/cards.css: il ritaglio di ogni illustrazione sulla propria cornice nera.

Le illustrazioni hanno un margine bianco attorno alla cornice, diverso da carta a carta.
Per ogni file misura la cornice e scrive tre percentuali (larghezza, sinistra, alto) che il
CSS usa per far combaciare la cornice con il bordo della carta. Non modifica le immagini.

Uso: python3 art/build-frames.py   (richiede Pillow e numpy; va rilanciato se cambiano le immagini)
"""
import glob, os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
ASPECT = 0.7      # larghezza/altezza della carta a schermo (.card in style.css)
INSET = 3         # pixel tolti a ogni lato per non lasciare aloni chiari sul bordo


def frame(path):
    im = np.asarray(Image.open(path).convert('L'))
    h, w = im.shape
    dark = im < 70
    ys = np.where(dark.sum(1) > w * 0.5)[0]
    xs = np.where(dark.sum(0) > h * 0.5)[0]
    return w, h, xs.min() + INSET, xs.max() - INSET, ys.min() + INSET, ys.max() - INSET


def rule(selector, path):
    w, h, x0, x1, y0, y1 = frame(path)
    fw, fh = x1 - x0, y1 - y0
    # la cornice copre la carta (larga 1, alta 1/ASPECT); l'eccesso sull'altro asse resta nel nero
    s = max(1 / fw, (1 / ASPECT) / fh)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    width = w * s * 100
    left = -(cx * s - 0.5) * 100
    top = -(cy * s - 0.5 / ASPECT) / (1 / ASPECT) * 100
    return '%s{--w:%.2f%%;--l:%.2f%%;--t:%.2f%%}' % (selector, width, left, top)


out = ['/* Generato da art/build-frames.py: non modificare a mano. */']
for f in sorted(glob.glob(os.path.join(ROOT, 'cards', '*.jpg'))):
    slug = os.path.basename(f)[:-4]
    out.append(rule('[data-art="%s"]' % slug, f))
for name in ('back-ticket', 'back-asset'):
    out.append(rule('[data-art="%s"]' % name, os.path.join(ROOT, 'board', name + '.jpg')))
with open(os.path.join(ROOT, '..', 'public', 'cards.css'), 'w') as fh:
    fh.write('\n'.join(out) + '\n')
print(len(out) - 1, 'regole')
