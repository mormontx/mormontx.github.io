#!/usr/bin/env python3
"""Compose the social card public/og.png for Pedagogical Tectonics.

Paper background + hairline inner frame, the hero's chair-ring model cropped
from qa/f2-hero-1440.png and faded into the paper on the left, and a short
left-aligned type stack. Runs with the bundled Python (Pillow).
"""
from __future__ import annotations

from PIL import Image, ImageDraw, ImageFont

HERE = __file__.rsplit("/", 1)[0] + "/.."

CARD_W, CARD_H = 1200, 630
BORDER_INSET = 24
PAPER = (249, 248, 246)
INK = (26, 26, 26)
MUTE = (110, 106, 99)
HAIRLINE = (229, 226, 220)
ACCENT = (168, 93, 107)

# --- 1. Model crop -------------------------------------------------------
# qa/f2-hero-1440.png is 1440x900. The chair-ring model sits on the right;
# this 700x630 crop keeps the full ring + its contact shadow and stops just
# above the tiny "MODEL 01 …" caption line (y~872 in the screenshot).
SRC = f"{HERE}/qa/f2-hero-1440.png"
CROP = (740, 240, 1440, 870)  # 700 x 630

hero = Image.open(SRC).convert("RGB")
model = hero.crop(CROP)

# Horizontal alpha fade on the left edge so the crop blends into the paper
# with no visible seam.
FADE_W = 150
alpha = Image.new("L", model.size, 255)
ramp = Image.new("L", (FADE_W, model.size[1]), 0)
for x in range(FADE_W):
    val = round(255 * (x / (FADE_W - 1)))
    for y in range(model.size[1]):
        ramp.putpixel((x, y), val)
alpha.paste(ramp, (0, 0))
model.putalpha(alpha)

card = Image.new("RGB", (CARD_W, CARD_H), PAPER)
card.paste(model, (CARD_W - 700, 0), model)

# --- 2. Type -------------------------------------------------------------
def load(path: str, size: int, index: int | None = None) -> ImageFont.FreeTypeFont:
    if index is None:
        return ImageFont.truetype(path, size)
    return ImageFont.truetype(path, size, index=index)

TIMES = "/System/Library/Fonts/Times.ttc"
COURIER = "/System/Library/Fonts/Supplemental/Courier New.ttf"

serif_bold = load(TIMES, 52, index=1)
serif_italic = load(TIMES, 52, index=2)
mono = load(COURIER, 15)

draw = ImageDraw.Draw(card)

def tracked(draw, xy, text, font, fill, tracking=0):
    """Draw text with manual letter-spacing; returns total width."""
    x, y = xy
    total = 0
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        w = draw.textlength(ch, font=font)
        x += w + tracking
        total += w + tracking
    return total - tracking

def text_width(text, font, tracking=0):
    return sum(draw.textlength(ch, font=font) for ch in text) + tracking * (len(text) - 1)

# Measure title lines to keep them inside the left 520px.
t1 = "Teaching lives in"
t2 = "unrepeatable"
t3 = "moments."
w1 = text_width(t1, serif_bold)
w2 = text_width(t2, serif_italic)
w3 = text_width(t3, serif_bold)

# Mono footer split into two lines so it never crowds the frame.
m1 = "A teaching portfolio composed as"
m2 = "an architectural monograph · tugcan yildirim"

EYEBROW = "PEDAGOGICAL TECTONICS"
eyebrow_size = 14
mono_eyebrow = load(COURIER, eyebrow_size)
eyebrow_tracking = 3
eyebrow_w = text_width(EYEBROW, mono_eyebrow, eyebrow_tracking)

LINE_H_TITLE = 58
LINE_H_MONO = 20
GAP_EYEBROW = 22
GAP_TITLE = 26

# vertical stack, centred in the framed area (24..606)
block_h = (
    20  # eyebrow line
    + GAP_EYEBROW
    + 3 * LINE_H_TITLE
    + GAP_TITLE
    + 2 * LINE_H_MONO
)
top = (CARD_H - block_h) // 2
LEFT = 48

y = top
# eyebrow
tracked(draw, (LEFT, y), EYEBROW, mono_eyebrow, ACCENT, eyebrow_tracking)
y += 20 + GAP_EYEBROW
# title
draw.text((LEFT, y), t1, font=serif_bold, fill=INK)
y += LINE_H_TITLE
draw.text((LEFT, y), t2, font=serif_italic, fill=INK)
y += LINE_H_TITLE
draw.text((LEFT, y), t3, font=serif_bold, fill=INK)
y += LINE_H_TITLE + GAP_TITLE
# mono footer
draw.text((LEFT, y), m1, font=mono, fill=MUTE)
y += LINE_H_MONO
draw.text((LEFT, y), m2, font=mono, fill=MUTE)

# --- 3. Hairline inner frame (drawn last, over the model) ---------------
draw.rectangle(
    (BORDER_INSET, BORDER_INSET, CARD_W - BORDER_INSET - 1, CARD_H - BORDER_INSET - 1),
    outline=HAIRLINE,
    width=1,
)

out = f"{HERE}/public/og.png"
card.save(out, optimize=True)
print("saved", out)
print("size", card.size)
print("title widths", w1, w2, w3, "eyebrow_w", eyebrow_w)
print("mono widths", text_width(m1, mono), text_width(m2, mono))
