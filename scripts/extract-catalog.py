"""One-time helper: pull product photos out of the catalogue PDF.

Usage:  python -I scripts/extract-catalog.py <catalog.pdf>

Writes src/assets/products/<slug>.jpg (original JPEG bytes, no re-encode;
Astro generates AVIF/WebP at build) and prints each image's average colour,
which goes into `tone` in src/data/products.ts as the placeholder colour.
"""
import os
import sys

import fitz  # PyMuPDF

# PDF image xref -> product slug (mapped by position under each caption)
XREF_TO_SLUG = {
    1178: "rose-petals", 1172: "mango-daisy-jar", 1181: "blush-bloom", 1175: "golden-hour",
    1193: "sea-shell", 1199: "floral-daisy-pearl-urli", 1202: "urli-candle", 1196: "kulhad-thandai",
    1214: "peony-heart", 1220: "iced-matcha-latte", 1223: "daisy-bouquet", 1217: "daisy-flowers-white-yellow",
    1241: "choco-iced-latte", 1235: "daisy-flowers-blue", 1238: "daisy-flowers-lavender", 1244: "daisy-urli-bowl-pearls",
    1255: "diwali-hero",
    1267: "laxmi-padam-lotus-urli", 1277: "floral-urli-gold-candles", 1287: "floral-urli-rose-candles",
    1297: "floral-candle-rose-bud", 1307: "clay-diya-rose-pearls", 1317: "clay-diya-mini-daisy",
    1327: "laddo-modak", 1337: "laddoo-modak-candles", 1347: "tealight-cups-rose",
    1357: "tealight-lavender-rose", 1367: "colourful-tealight-cups", 1377: "single-daisy-flower",
    1387: "designer-diya-mini-daisy", 1397: "daisy-tealight-red-yellow", 1407: "daisy-tealight-lavender-white",
    1417: "daisy-tealight-yellow-white", 1427: "mini-daisy-set-pink", 1437: "mini-daisy-set-yellow",
    1447: "mini-daisy-set-blue", 1457: "mini-daisy-set-lavender", 1467: "mini-daisy-set-red",
    1477: "mini-daisy-set-green", 1487: "mini-daisy-set-orange",
}


def avg_hex(pix: fitz.Pixmap) -> str:
    s, n = pix.samples, pix.n
    count = len(s) // n
    rgb = [sum(s[c::n]) // count for c in range(3)]
    return "#%02x%02x%02x" % tuple(rgb)


def main() -> None:
    src = sys.argv[1]
    out = os.path.join(os.path.dirname(__file__), "..", "src", "assets", "products")
    os.makedirs(out, exist_ok=True)
    doc = fitz.open(src)
    for xref, slug in XREF_TO_SLUG.items():
        info = doc.extract_image(xref)
        with open(os.path.join(out, f"{slug}.jpg"), "wb") as f:
            f.write(info["image"])
        pix = fitz.Pixmap(info["image"])
        if pix.n > 3:
            pix = fitz.Pixmap(fitz.csRGB, pix)
        pix.shrink(3)
        print(f"{slug}\t{info['width']}x{info['height']}\t{avg_hex(pix)}")


if __name__ == "__main__":
    main()
