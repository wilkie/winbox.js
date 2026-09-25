---
kind: function
module: USER
name: GetSystemMetrics
ordinal: 179
summary: Returns one of the sizes USER lays windows out with, such as the screen, a caption bar, a menu bar, a border or an icon, in device pixels.
versions:
  '3.1': exact
probes: [devcaps, chrome]
records: [GetSystemMetrics, metric]
topics: [display-drivers]
---

## Observed behaviour

- [[measured]] [[probe:devcaps]] asks ten metrics on each of four displays. Four depend on the display and six do not:

| Index                         | VGA     | Super VGA | EGA     | Hercules |
| ----------------------------- | ------- | --------- | ------- | -------- |
| `SM_CXSCREEN` x `SM_CYSCREEN` | 640x480 | 800x600   | 640x350 | 720x348  |
| `SM_CYCAPTION`                | 20      | 20        | 18      | 18       |
| `SM_CYMENU`                   | 18      | 18        | 16      | 16       |
| `SM_CXBORDER`, `SM_CYBORDER`  | 1, 1    | 1, 1      | 1, 1    | 1, 1     |
| `SM_CXFRAME`, `SM_CYFRAME`    | 4, 4    | 4, 4      | 4, 4    | 4, 4     |
| `SM_CXICON`, `SM_CYICON`      | 32, 32  | 32, 32    | 32, 32  | 32, 32   |

- [[measured]] `SM_CXSCREEN` and `SM_CYSCREEN` are the same numbers as [[fn:GDI.GetDeviceCaps]] reports for `HORZRES` and `VERTRES` on every display.
- [[measured]] winbox.js gives the same answer as Windows in all 10 records on each of the four displays.

## Nuances

- [[measured]] The caption and menu bars are two pixels shorter on the two displays that report 72 dots to the inch down (EGA and Hercules). The two displays that report 96 have the taller bars. The size of the screen does not decide it: the Super VGA's bars match the VGA's at 800x600.
- [[inferred]] The bars follow the height of the system font at the display's vertical resolution. The font is realised from the driver's resolution, so a shorter font gives a shorter bar. [[probe:devcaps]] does not record the system font's height, so the fixtures do not show this.
- [[measured]] Borders, frames and icons are the same size in pixels on all four displays. On the EGA and the Hercules, their pixels are taller than they are wide. See [[topic:non-square-pixels]].
- [[measured]] [[probe:chrome]] asks 32 indices on each display: the scroll bars, the dialog frame, the icon and cursor, the sizing and minimize boxes, the smallest a window may be tracked to, and the rest that size a window's frame. On a VGA the scroll bar is 17 pixels each way, the dialog frame and sizing frame 4, and the smallest window 102 by 26. The EGA's horizontal scroll bar is 14 high; the Hercules's scroll bars are 15 wide and 11 high, and its smallest window 105 by 24.
- [[measured]] `SM_CYFULLSCREEN` is the screen's height less the caption's on all four displays: 460, 332, 580 and 330. `SM_CXFULLSCREEN` is the screen's width.
- [[measured]] `SM_MOUSEPRESENT` is 1 and `SM_DEBUG`, `SM_SWAPBUTTON` and `SM_CYKANJIWINDOW` are 0, as the oracle's installations are set up.
- Not yet measured: the double-click sizes and anything past index 35.

## Implementation

Each display mode carries the metrics [[probe:chrome]] recorded for it, by index, in `src/win16/display-modes.ts`: the VGA's, which the Super VGA shares, the EGA's and the Hercules's. The screen and full-screen sizes follow the display's own size. The two 256-colour modes take the VGA's, which is not recorded. An index nothing recorded returns 0. See [[topic:display-drivers]].
