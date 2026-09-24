---
kind: topic
name: Synthetic bold
summary: How Windows 3.1 makes a bold it has no file for — who smears the glyph, where the overhang is kept or cut, and what it costs every measurement.
probes: [smearrun, smearmod, smeargnd, smearglf, simext, rotstyle]
---

A request heavier than the face it maps to is drawn by **smearing** the regular glyph one pixel to the right. Who does the smearing depends on the device and on whether the text is turned, and each choice changes what reaches the page and what `GetTextExtent` reports.

## When it happens

[[measured]] A TrueType face is smeared above weight 550 and up to 600; above 600 a family's bold file is used instead, drawn plainly. Symbol, which has no bold file, is smeared at every weight above 550. See [[fonts:8a]].

[[read out]] Where the mapper realises such a font, it hands the driver a text transform whose `txfWeight` is the face's weight **plus 300**, so a request at 600 reaches the driver as 700 over a face of 400 (`GDI.EXE` seg3 `07e1`, `098e`, `13a9`). Two of those sites also set `txfAccelerator`'s double-weight bit and add one to `txfOverhang`; the third, for a strike the device realises, does so only where the device's `TEXTCAPS` lacks `TC_EA_DOUBLE` (loaded at `0643`).

## Upright, on a device with `TC_EA_DOUBLE`

A VGA's display driver smears the text itself, and GDI only adds a pixel to every character's width.

- [[read out]] GDI's TrueType text builds a width array — each width plus one pixel when the device has `TC_EA_DOUBLE` (`GDI.EXE` seg1 `6b73`) — and hands it to the driver's `ExtTextOut`.
- [[read out]] `VGA.DRV`'s 386 `StrBlt` ORs every glyph into its buffer twice, at its bit phase and one to the right, not cut to the glyph's width (seg2 `17c2`). Every overhang reaches the buffer.
- [[read out]] What reaches the page is masked to where the layout ends. The width-array loop (seg2 `0424`) lays the **last** glyph at its own bitmap's width and never reads the bold flag, so a transparent string ends at the last glyph's box and its overhang is cut.
- [[read out]] With `ETO_OPAQUE` and a rectangle covering the rows, `0744` carries the end on to the next byte boundary but not past the rectangle, whose right edge is the bold cell. So the last overhang survives opaque when it does not begin a new byte and lies inside the cell.
- [[measured]] Every other glyph keeps its whole overhang, in both modes: not one such column is dropped in 1,280 records of [[probe:smearrun]] and [[probe:smearmod]].

## Where GDI smears for itself

On a device without `TC_EA_DOUBLE` — a Hercules — and for **turned** text on any device, GDI does the bold itself, in seg16 `0030`.

- [[read out]] It draws the whole string **twice**: first with the pen at x + 1, keeping the background mode, then at x, transparent (`020a`, `0294`). Two whole draws a device pixel apart are a smear one column to the right on the device, not along the text, and nothing cuts either copy.
- [[read out]] Turned text gets this even on a VGA, because GDI will not leave a turned string's effects to a device that cannot turn text (`TC_CR_ANY`, seg1 `35b2`).
- [[read out]] It raises the character extra by one while it draws (`0070`). With the widths' own pixel on a VGA, a turned smeared glyph advances **two** pixels; on a Hercules, which has no widths pixel, one.
- [[read out]] In `OPAQUE` mode it first draws a single space — the constant at `ds:041e` in seg48 — at the pen. That space's ground shows left of the run's ground, which the first pass paints at x + 1. [[probe:smeargnd]], 48 of 48 on each display.

## What it costs a measurement

- [[read out]] `GetTextExtent` adds `count + 1` for a double weight the device cannot do (seg1 `3cf3`), after any turned scaling. See [[topic:non-square-pixels]].
- [[measured]] `GetGlyphOutline` is never smeared: every plain and smeared pair is byte for byte the same. The engine is not told about weight at all.

The full derivation, with every refused alternative and its count, is in [[fonts:8u]].
