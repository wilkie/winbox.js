---
kind: function
module: GDI
name: RealizeDefaultPalette
ordinal: 365
summary: Realizes the stock palette: on a palette display, frees the slots between the static colours; elsewhere does nothing.
versions:
  '3.1': exact
probes: [dcinner]
topics: [palettes]
---

## Observed behaviour

- [[measured]] On the 256-colour display it answers nought, and the stock palette becomes GDI's foreground palette: a context with another selected is then no longer current ([[probe:dcinner]]).
- [[measured]] On the VGA it answers a non-zero word and changes nothing: `IsDCCurrentPalette` answers as before.

## Inside Windows

[[read out]] `GDI.EXE` seg22 `101d`: on a device with `RC_PALETTE` every system palette entry between the static colours is marked free, keeping its colour, the count of palette changes goes up, the stock palette becomes both GDI's foreground palette and the one realized last, and seg22 `0cfb` realizes it as the stock palette, which only resets the driver's translation and answers nought. On any other device nothing is done, and the answer is what AX held on entry: GDI's data segment.

## Implementation

In both engines as read out; on a display of fixed colours the answer is the selector that stands for GDI's data segment. [[probe:dcinner]] agrees in both.
