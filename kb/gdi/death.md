---
kind: function
module: GDI
name: Death
ordinal: 121
summary: Calls the display driver's Disable through a device context's driver and answers what it does; WinBox's display is not turned off.
versions:
  '3.1': unrecorded
probes: []
source: src/win16/gdi/visible-region.ts
topics: [visible-regions]
---

## Observed behaviour

Not recorded: under the recorder it would turn the display off.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `2067`: nought for a handle of nought; else the context's driver's `Disable` (its table's entry at 0Ch) called with the context's device, and its AX answered. USER calls it from `DisableOEMLayer` as it gives the screen to a full-screen DOS program (`USER.EXE` seg5 `01ba`).

[[read out]] What the display drivers' `Disable` answers:

| Driver                                    | Where                                 | Answer                                                                                                                                                                  |
| ----------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VGA.DRV`                                 | seg4 `0274`                           | −1 (`mov ax,0FFFFh` at `028d`, after the text mode is set again and its hook on INT 2Fh taken off)                                                                      |
| `SVGA256.DRV`                             | seg3 `0000`                           | −1 (`0015`)                                                                                                                                                             |
| `EGA.DRV`, `SUPERVGA.DRV`, `HERCULES.DRV` | seg4 `0196`, seg4 `03ba`, seg2 `0164` | −1                                                                                                                                                                      |
| `XGA.DRV`                                 | seg3 `0900`                           | the word at 1816h of its data (`09a9`), set from INT 2Fh function 1686h, DPMI's "get CPU mode" (`038d`-`0392`): nought in protected mode, where Windows 3.1 always runs |
| `8514.DRV`                                | seg6 `03b7`                           | what AX holds after its hook on INT 2Fh is taken off (`0225`): 252Fh, from the DOS call that sets the vector back, while the hook is in                                 |

The 8514/a's **depends on state**: called again with no `Enable` between, the hook is already off and AX is what the BIOS's INT 10h calls before left. Not measured.

## Implementation

In both engines (`src/win16/gdi/visible-region.ts` with `display-driver.ts`' `disableAnswer`; `crates/winbox-win16/src/gdi/visible_region.rs` with `Display::disable_answer`): the display's driver's answer from the table above, nothing turned off; the 8514/a's second call answers as its first. Nought for no context and for a printer's, whose driver's `Disable` is not followed.
