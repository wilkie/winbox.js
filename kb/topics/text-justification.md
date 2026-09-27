---
kind: topic
name: Text justification
summary: How Windows 3.1 spreads SetTextJustification's extra pixels over a line's break characters — the division, the error term, the two ways a negative remainder goes, and how the term carries from call to call — read out of GDI and the display driver and recorded in two faces.
probes: [justify]
---

[[fn:GDI.SetTextJustification]] asks for extra pixels spread over the break characters of the text drawn next. Write justifies a paragraph with it. [[read out]] of `GDI.EXE` (seg1 `0fef`, `6bb3`, `374d`, `3bcf`, `6a65`) and `VGA.DRV` (seg2 `0462`, `0542`, `0c3c`, `0c82`). [[measured]] [[probe:justify]] records it:, which draws MS Sans Serif at 13 and Arial at 16 into a monochrome bitmap. It covers an extra that divides evenly, one that does not, one break, a negative extra, justification with character extra, a line drawn in two parts, and `ExtTextOut` with its own spacing. winbox.js agrees with all 26 records.

- **The division.** The extra, in device units, is divided by the count, truncating: each break gets that. The remainder, with the extra's sign, is spread by an error term that starts at `count >> 1` plus one. A positive remainder comes off the term at each break. Where the term reaches nought, the break gets one pixel more and the count goes back on. So 7 over 3 is 2, 3, 2.
- **A negative remainder is handled two ways.** GDI, which draws TrueType, adds it to the term and takes a pixel off where the term reaches nought, so −3 over 2 is −1, −2. The display driver, which draws the bitmap fonts, takes the remainder off the term, which only grows it, and takes a pixel off wherever the term is nought or more. So MS Sans Serif's −3 over 2 is −2, −2: four pixels, not three.
- **A break** is the font's break character. A character outside the font is its default character first. `ExtTextOut`'s own spacing is justified too: 10 a character, with 4 at each break, places the letters 24 apart.
- **The term lives in the device context and carries on from call to call.** A bitmap font's `TextOut` moves it on once, through GDI's measuring pass after the draw; the driver's draw keeps nothing. Its `GetTextExtent` saves and restores it. A TrueType `TextOut` moves it on twice, as it draws and as GDI measures after, and its `GetTextExtent` once. A line of three breaks drawn in two parts therefore splits as 2 then 3, 2 in MS Sans Serif, and 2 then 2, 3 in Arial.
- `GetTextExtent` includes the justification, and the character extra after every character: "a b c" with a character extra of one measures five more. It had not counted the character extra before.

## Not followed

An extra with a count of nought, which divides by nought in GDI; GDI keeping every advance but the last from going below nought; vector fonts, taken to be GDI's as TrueType is; justified text centred or right-aligned, and its opaque background, which the probe does not draw.

## In winbox.js

`src/win16/gdi/justify.ts`. `TextOut` and `ExtTextOut` draw justified text through the per-character spacing `ExtTextOut` already had; `GetTextExtent` adds what the breaks add.
