#!/usr/bin/env python3
"""Photos de plats de la carte officielle (PDF scanné) → WebP dans public/visuels/.

Source : assets/source/menu.pdf — carte Heyzine du restaurant, 6 pages scannées,
chaque page = UNE image JPEG 887×1241 px (150 ppp ; la page 3 fait 886 px de large). Pas de texte, pas d'images
de plats séparées : les photos sont obtenues par RECADRAGE des pages.

Outil poppler : `pdfimages -j` (extrait les JPEG des pages tels quels, sans
rééchantillonnage — plus simple et plus fidèle que `pdftoppm`, qui re-rastérise).
Dépendances : poppler-utils + Pillow (avec WebP). Rien d'autre.

Usage (depuis la racine du repo) :
    python3 scripts/extraire-photos-menu.py
Rejouable : régénère les mêmes 18 fichiers (9 plats × fiche + vignette).

Les cadres ont été relevés et vérifiés visuellement un par un (planche de
contrôle du coordinateur, lot P1-B2, 10/11/2026) : chaque cadre montre le plat
légendé par le restaurant. Ne JAMAIS ajouter un cadre sans l'avoir vérifié à
l'œil — voir public/visuels/SOURCES.md pour les photos écartées et pourquoi.
"""

import os
import subprocess
import sys
import tempfile

from PIL import Image

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = os.path.join(RACINE, 'assets', 'source', 'menu.pdf')
SORTIE = os.path.join(RACINE, 'public', 'visuels')

TAILLE_PAGE = (887, 1241)
MARGE = 4  # px à l'intérieur du cadre blanc
FICHE_LARGEUR_MAX, FICHE_QUALITE = 720, 80
VIGNETTE_LARGEUR_MAX, VIGNETTE_QUALITE = 192, 75

# slug → (page 1-6, (x0, y0, x1, y1) = bords EXTÉRIEURS du cadre blanc dans la page 887×1241)
CADRES = {
    'poke-bowl': (2, (626, 1054, 837, 1194)),  # petite photo (~204×132 natifs)
    'dynamite': (3, (64, 332, 413, 565)),
    'mi-prat': (3, (64, 759, 412, 990)),
    'pad-thai': (3, (472, 759, 820, 990)),
    'crousti-poulet': (4, (65, 88, 413, 320)),
    'khao-prat': (4, (473, 89, 820, 320)),
    'curry-vert': (4, (66, 452, 414, 683)),
    'tigre-qui-pleure': (4, (473, 453, 820, 684)),
    'bo-bun': (4, (472, 818, 821, 1050)),
}
# Cadres relevés mais NON livrés (décision coordinateur, voir SOURCES.md) :
#   Loc Lac p.4 (65,818,413,1049) et Mango Stick p.6 (160,683,426,860) : les
#   photos existantes (menu-loc-lac.jpg, menu-mango-sticky-rice.jpg) sont meilleures.


def pages(dossier):
    """Extrait les 6 JPEG de pages avec pdfimages ; renvoie les images PIL, page 1 en tête."""
    subprocess.run(['pdfimages', '-j', PDF, os.path.join(dossier, 'p')], check=True)
    fichiers = sorted(f for f in os.listdir(dossier) if f.startswith('p-'))
    if len(fichiers) != 6:
        sys.exit(f'Attendu 6 images de pages, trouvé {len(fichiers)} : {fichiers}')
    images = [Image.open(os.path.join(dossier, f)).convert('RGB') for f in fichiers]
    for f, im in zip(fichiers, images):
        # La page 3 du scan fait 886 px de large : ±1 px toléré.
        if any(abs(a - b) > 1 for a, b in zip(im.size, TAILLE_PAGE)):
            sys.exit(f'{f} : {im.size[0]}×{im.size[1]} au lieu de 887×1241 — le PDF a changé, revérifier les cadres.')
    return images


def reduire(im, largeur_max):
    if im.width <= largeur_max:
        return im  # jamais agrandi au-delà du natif
    return im.resize((largeur_max, round(im.height * largeur_max / im.width)), Image.LANCZOS)


def enregistrer(im, nom, qualite):
    chemin = os.path.join(SORTIE, nom)
    im.save(chemin, 'WEBP', quality=qualite, method=6)
    print(f'  {nom:38} {im.width:>4}×{im.height:<4} {os.path.getsize(chemin):>7} o')


def main():
    with tempfile.TemporaryDirectory() as dossier:
        imgs = pages(dossier)
        print(f'Source : {os.path.relpath(PDF, RACINE)} — {len(imgs)} pages 887×1241')
        for slug, (page, (x0, y0, x1, y1)) in CADRES.items():
            photo = imgs[page - 1].crop((x0 + MARGE, y0 + MARGE, x1 - MARGE, y1 - MARGE))
            enregistrer(reduire(photo, FICHE_LARGEUR_MAX), f'menu-{slug}.webp', FICHE_QUALITE)
            enregistrer(reduire(photo, VIGNETTE_LARGEUR_MAX), f'menu-{slug}-vignette.webp', VIGNETTE_QUALITE)


if __name__ == '__main__':
    main()
