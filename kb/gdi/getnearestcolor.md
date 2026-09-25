---
kind: function
module: GDI
name: GetNearestColor
ordinal: 154
summary: Returns the colour a device draws a given colour as, when it is drawn as one colour rather than a pattern.
versions:
  '3.1': exact
probes: [dither]
source: src/win16/gdi/GetNearestColor.ts
---

## Observed behaviour

- [[measured]] On the screen, the answer is one of the display's own colours. All 194 `nearest` records of [[probe:dither]] agree on each of the VGA, the Super VGA, the EGA and the Hercules.
- [[measured]] The answer is not the nearest colour by distance. Red 192, green 128, blue 0 gives yellow, and red 192, green 128, blue 64 gives red. A grey of 64 gives black, and 68 gives `808080`. The EGA gives its own `404040` for a grey of 64, and `808080` for `c0c0c0`.

## Nuances

- [[refused]] The nearest colour in red, green and blue by squared distance agrees with 149 of the VGA's 194 records and 155 of the EGA's.
- Not yet measured: a memory device context with a monochrome bitmap selected. The driver's flags say which colours it would take as white. See [[topic:brush-dithering]].

## Inside Windows

- [[read out]] GDI passes the colour to the display driver's `ColorInfo`, export 2. The colour drivers sort the channels and classify the colour's shape as one channel, two channels, or a grey, and then choose from a short list of levels. The Hercules driver compares red plus green plus blue with 382. The steps are in [[topic:brush-dithering]].

## Implementation

`matchedIndex` in `src/raster/colour-match.ts` is the drivers' routine, with their tables. The answer is the palette's colour for the index it chooses, for the bitmap selected into the device context, or for the display.
