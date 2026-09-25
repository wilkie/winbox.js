---
kind: function
module: USER
name: GetSystemMetrics
ordinal: 179
summary: Returns one of the sizes USER lays windows out with, such as the screen, a caption bar, a menu bar, a border or an icon, in device pixels.
versions:
  '3.1': exact
probes: [devcaps]
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
- Not yet measured: every index the probe does not ask, including the scroll bar, cursor and double-click sizes, `SM_CXMIN` and `SM_CYMIN`, `SM_CYFULLSCREEN`, `SM_MOUSEPRESENT` and `SM_DEBUG`.

## Implementation

Each display mode has its own table of these metrics in `src/win16/display-modes.ts`. The VGA and the Super VGA use one table. The EGA and the Hercules use a copy with the caption and menu two pixels shorter. An index the table does not name returns 0. See [[topic:display-drivers]].
