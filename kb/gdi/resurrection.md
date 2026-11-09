---
kind: function
module: GDI
name: Resurrection
ordinal: 122
summary: Calls the display driver's Enable through a device context's driver and answers what it does; on a palette device the palette is set again.
versions:
  '3.1': unrecorded
probes: []
source: crates/winbox-win16/src/gdi/visible_region.rs
topics: [visible-regions]
---

## Observed behaviour

Not recorded: under the recorder it would follow [[fn:GDI.Death]], which turns the display off.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `208e`: nought for a handle of nought; else the context's driver's `Enable` (its table's entry at 10h) called for the device set up -- the style nought -- with the six words given as its device type, output file and data, and its AX answered; on a palette device (`RC_PALETTE`) the palette is set again (`20cc`-`2102`). USER calls it from `EnableOEMLayer` as it takes the screen back (`USER.EXE` seg5 `017e`).

[[read out]] The display drivers' `Enable` answers 1 once the mode is set: `VGA.DRV` seg4 `02b2` (seg4 `008e` answers 1 once the BIOS reports mode 12h; where not, a message and Windows ended), `SVGA256.DRV` seg3 `07fc` (1 at seg3 `02d6`), `8514.DRV` seg6 `030e` (1 at `03a9`), `XGA.DRV` seg3 `0755` (1 at `08e8`). The EGA's, the Super VGA's and the Hercules's end as the VGA's does.

## Implementation

In WinBox, (`enableAnswer`, `Display::enable_answer`): 1, WinBox's display never having been turned off, its palette still set. Nought for no context and for a printer's.
