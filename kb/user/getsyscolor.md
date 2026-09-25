---
kind: function
module: USER
name: GetSysColor
ordinal: 180
summary: Returns one of the system colours USER draws windows in, such as the caption, the window face or a button's shadow, by COLOR_ index.
versions:
  '3.1': exact
probes: [chrome]
source: src/win16/user/GetSysColor.ts
topics: [display-drivers]
---

## Observed behaviour

- [[measured]] Each display has its own default colours. [[probe:chrome]] asks all 21 on each display, and none of the oracle's installations has a `[colors]` section in `WIN.INI`, so these are USER's defaults. On a VGA the desktop and button face are light grey `c0c0c0`, an active caption is dark blue, and a button's shadow is dark grey `808080`. The Super VGA's are the VGA's.
- [[measured]] The EGA's differ: its scroll bar colour is `818181`, which is not one of the sixteen colours, so a brush of it is dithered, and its button face is white.
- [[measured]] The Hercules's are greys: `3f3f3f`, `7f7f7f` and `bfbfbf` among black and white.

## Nuances

- Not yet measured: a `[colors]` section in `WIN.INI`, which would override the defaults, and an index past `COLOR_BTNHIGHLIGHT`.

## Implementation

The recorded defaults are a table per display in `src/win16/display-modes.ts`. `WIN.INI` is not read for colours yet. The two 256-colour modes take the VGA's, which is not recorded. Until [[probe:chrome]] this call was a stub, and declared as taking no argument when it takes one.
