---
kind: function
module: GDI
name: GetNearestColor
ordinal: 154
summary: Returns the colour a device draws a given colour as, when it is drawn as one colour rather than a pattern.
versions:
  '3.1': exact
probes: [dither, nearest2, penmatch]
source: src/win16/gdi/GetNearestColor.ts
---

## Observed behaviour

- [[measured]] On the screen, the answer is one of the display's own colours. All 194 `nearest` records of [[probe:dither]] agree on each of the VGA, the Super VGA, the EGA and the Hercules.
- [[measured]] The answer is not the nearest colour by distance. Red 192, green 128, blue 0 gives yellow, and red 192, green 128, blue 64 gives red. A grey of 64 gives black, and 68 gives `808080`. The EGA gives its own `404040` for a grey of 64, and `808080` for `c0c0c0`.

- [[measured]] [[probe:nearest2]] asks for a cube of 512 colours, eight levels a side, and six colours from Championship Slots' pictures. winbox.js agrees with all 518 on the VGA.
- [[measured]] A colour table becomes the device's colours by the same rule. [[probe:dibmap]] gives [[fn:GDI.CreateDIBitmap]] a 256-colour DIB, a cube of six levels a side and forty greys. Every pixel comes out as `GetNearestColor` answers for its colour, where the nearest by distance misses 78 of them. winbox.js matches colour tables this way in `CreateDIBitmap` and `LoadBitmap`.
- [[measured]] The same DIB drawn onto the screen by [[fn:GDI.SetDIBitsToDevice]], and stretched onto a memory bitmap by [[fn:GDI.StretchDIBits]], follows the same rule for all 256 colours. winbox.js draws DIBs this way.
- [[measured]] `SetDIBitsToDevice` onto a memory bitmap draws nothing and answers -1, as [[probe:dibdev]] recorded. A first recording seemed to show colours by no rule. It was the new bitmap's own contents, left uncleared by the probe. Once the probe filled the bitmap white first, it stayed white.

## Nuances

- [[refused]] The nearest colour in red, green and blue by squared distance agrees with 149 of the VGA's 194 records and 155 of the EGA's.
- [[measured]] A pen, text, a background and [[fn:GDI.SetPixel]] draw the colour this answers, and a monochrome bitmap takes as white the colours the driver's flags name. [[probe:penmatch]] recorded 512 colours of each kind, on the VGA's bitmaps and on a monochrome one. `SetPixel` answers the colour it drew. See [[topic:brush-dithering]].
- Not yet measured: `GetNearestColor` itself on a memory device context with a monochrome bitmap selected.

## Inside Windows

- [[read out]] GDI passes the colour to the display driver's `ColorInfo`, export 2. The colour drivers sort the channels and classify the colour's shape as one channel, two channels, or a grey, and then choose from a short list of levels. The Hercules driver compares red plus green plus blue with 382. The steps are in [[topic:brush-dithering]].

## Implementation

`matchedIndex` in `src/raster/colour-match.ts` is the drivers' routine, with their tables. The answer is the palette's colour for the index it chooses, for the bitmap selected into the device context, or for the display.
