---
kind: topic
name: Turned text
summary: What lfEscapement does — the size chosen, the matrix handed to the scaler, whether the glyph is hinted, and where each glyph, rule and ground lands.
probes: [rotate, rotangle, rotsize, rotpen, rotstyle, polyfill]
---

A font created with a non-zero escapement draws its text along a turned baseline. Every part of it — the size, the glyph, its placement, the alignment, the rules and the ground — follows rules measured against Windows 3.1 and, for most of them, read out of `GDI.EXE`. On a pixel that is not square each of them changes again; see [[topic:non-square-pixels]].

## The size and the matrix

- [[measured]] A turned request is sized by its own rule, not the upright one; `rotsize` is 520 of 520.
- [[measured]] GDI hands the scaler a whole-pixel matrix: the size times the angle's cosine and sine, each in sixteen-dot-sixteen and rounded with a half going away from nought. At thirty-three pixels per em and thirty degrees the sine entry is exactly 16.5, and Windows takes 17.
- [[read out]] The scaler takes each row's stretch as the larger of its two entries and turns by the entries divided by it, `FixDiv` rounding away from nought and `FixMul` adding a half. On a diagonal — a row whose two entries are equal or opposite — it nudges the whole outline a sixty-fourth across.
- [[measured]] An angle that is a whole number of turns draws exactly what upright text draws, and a tenth of a degree at fifteen per em rounds to the identity matrix.

## Whether the glyph is hinted

[[read out]] The fonts' `prep` asks `GETINFO` whether the glyph is rotated, and the scaler answers yes for a matrix that is not a multiple of a right angle — decided on the rounded matrix, not the angle. Told yes, every installed family switches grid-fitting off and dropout control on at every size. A turn by right angles is still hinted.

## Where each glyph lands

- [[measured]] The pen is carried down to the baseline by the ascent, and each glyph along it by the advances so far; each carry is rounded to a whole pixel on its own, in sixteen-dot-sixteen.
- [[measured]] The alignment is a carry of its own, apart from the ascent's: `TA_CENTER` and `TA_RIGHT` move back along the baseline, and `TA_BOTTOM` is two carries — down by the ascent and back up by the cell. Rounding them together loses `TA_CENTER` at forty-five degrees in every face.
- [[measured]] `ExtTextOut` walks the turned baseline with its array's distances, and `ETO_CLIPPED` does nothing to turned text.

## Rules and the ground

- [[measured]] A rule one row thick is the display driver's line between two ends, both drawn. A thicker rule is GDI's `Polygon` drawn with a one-pixel pen, its far edge carried from the near edge by the thickness less one. See [[topic:polygon-fill]].
- [[measured]] The opaque ground is `Polygon` with no pen, on the reference point carried along by the ground's width and down by the cell, each carry rounded on its own.

## Bold and slant turned

- [[read out]] A turned smeared string is GDI's own bold, drawn twice a device pixel apart; see [[topic:synthetic-bold]].
- [[measured]] A made-up slant turned is one matrix, not a shear followed by a turn: the turn's entries with a third of the first row, floored as a signed number, added to the second — 10 of 10, against 9 and 8 for the two readings refused.

The derivations are in [[fonts:8u]].
