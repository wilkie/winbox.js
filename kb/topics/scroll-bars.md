---
kind: topic
name: Scroll bars
summary: A window's scroll bars and scroll bar controls in Windows 3.1 — their ranges and positions, where the thumb is drawn, and their arrows turned off — read out of USER.EXE and measured on four displays.
probes: [mledit, chrome, noscroll]
---

A window with `WS_VSCROLL` or `WS_HSCROLL` has scroll bars in its frame. Each has a range and a position, and the thumb shows where the position is in the range. The code is in `USER.EXE` segment 18.

## Ranges and positions

- [[read out]] A window's bars start at the range 0 to 100, at 0 (seg1 `00d9`).
- [[read out]] `SetScrollPos` answers the position it replaces. The position is kept to the range, `min(max(min, pos), max)`, after every change of either. On a bar the window's style does not have, it stores nothing and answers 0 (seg18 `0d67`).
- [[read out]] `SetScrollRange` ignores a range whose span does not fit a signed word, which includes a minimum above the maximum. A range whose ends are equal takes the bar away, and any other range gives the window the bar if it had none. Either way the window is laid out again.
- [[read out]] A `SCROLLBAR` control starts at the range 0 to 0, from its creation parameters.

## The thumb

- [[read out]] Along the bar, each arrow is as long as its bitmap, but no longer than half the bar less a border, so the arrows shrink on a short bar. A bar with no room for them draws nothing at all (seg18 `073c`, `04b7`).
- [[read out]] The thumb's length comes from the display driver, not from the arrows: 17 by 17 on the VGA and Super VGA, 14 down by 18 across on the EGA, 15 by 16 on the Hercules. It starts a border back from the first arrow's inner edge.
- [[read out]] The thumb moves along the track by `(pos − min) × room / (max − min)`, rounded half up. `room` is the bar's length less both arrows and the thumb, plus two borders. A track shorter than the thumb shows no thumb.
- [[measured]] [[probe:mledit]]'s edit control sets its thumbs to 0, 13, 25, 50 and 75 down and 66 across, and every thumb lands where the formula puts it on all four displays. On the VGA, with the thumb starting at 16 and 15 pixels of room, 25 is at 20 (3.75 rounded up) and 50 at 24.
- [[read out]] A window without edges has its bars at its own edge. A window with edges has its bars share their outer line with the edge.

## Stretching the arrows

- [[read out]] The arrows are drawn with `StretchBlt`. None of the display drivers stretches, so GDI does it itself (`GDI.EXE` seg32 `03ba`).
  - **Within a pixel on both axes**, it copies the bitmap as it is. When enlarging, it then shows the last row and column once more (seg32 `0504`).
  - **On a colour display**, EGA or VGA, it stretches a device-independent copy (seg32 `099e`). Its error terms start at the larger size less half the smaller. Rows advance when the error reaches nought, and columns only when it passes nought. Enlarging `from` to `size`, row `d` shows `(d × from + from / 2) / size`, and column `d` shows `(d × from + from / 2 − 1) / size`, both rounded down.
  - **On a monochrome display**, the Hercules, it has an engine of its own (seg32 `0000`). Row `d` shows `(d × from + ⌈from / 2⌉ − 1) / size`. Columns are dealt out from the source, each `size / from` times, with the remainder spread one more at a time from the second column.
- [[measured]] Each of these paths shows in a recording:
  - the EGA's arrows, 14 rows made 16, repeat rows 3 and 10 ([[probe:chrome]]);
  - its grayed arrows, 17 columns made 18, repeat column 7 ([[probe:noscroll]]);
  - the Hercules's arrows, 11 rows made 16, repeat rows 1, 3, 5, 7 and 9;
  - its arrows on a 16-wide control, 15 by 11 made 16 by 11, repeat the last column.
- [[refused]] 2 variants: a single rule `(d × from + k) / size` for rows and columns alike fits no one `k`. It needs 6 or 7, then 5, then 7 for the three enlargings above. Reading GDI settled it: rows and columns differ by one in their comparison, and monochrome has its own engine.

## Arrows turned off

- [[read out]] `EnableScrollBar` turns a bar's arrows off: 1 is the top or left arrow, 2 the bottom or right, 3 both, and 0 turns them all on again (seg18 `017c`).
  - **A window's own bars** keep which arrows are off. The call answers whether any changed, and a bar that shows is drawn again at once (seg18 `0074`).
  - **A scroll bar control with both arrows off is a disabled window.**
    - A call asking for what the control already has answers 0.
    - Asking for both off, or for the one arrow that makes both, disables the window with `EnableWindow`. Asking for all on from both off enables it. The control's `WM_ENABLE` then sets its arrows all off or all on (seg18 `0a67`).
    - The answer is then made from what `EnableWindow` answered, which is whether the window had been disabled. If it had, the answer is 1 when it is enabled now. If it had not, the answer is the disabled style bit as a byte, 8.
    - Any other call turns arrows off one at a time, or all on, and answers 1 (seg18 `0031`). An arrow stays off until all are turned on.
    - A control made disabled is made with both arrows off.
- [[measured]] [[probe:noscroll]] turns a control's arrows off one at a time, then both, then both again, then all on. `EnableScrollBar` answers 1, 8, 0, 0 and 1. Turning off the bottom arrow after the top one disables the control, so it draws as both off. A window's own bar answers 1.
- [[read out]] An arrow that is off is drawn with the display driver's grayed bitmap, 32734 to 32737 (seg18 `0556`, `05fa`; seg3 `0f4c`). Each is stretched from its own size, which need not be the normal arrow's: the EGA's grayed left and right arrows are 17 wide, and its normal ones 18.
- [[read out]] A driver without grayed arrows, the Hercules's, gets USER's own (seg3 `1099`, `09f3`).
  - USER lays its bitmaps side by side in a strip, and copies each normal arrow in after the others.
  - It ORs each copy, one pixel in from its edges, with a brush of alternate black and white pixels (seg3 `13fb`). The brush is black where the strip's x and y add to an even number.
  - A black pixel of the arrow is left only where the brush is black.
- [[measured]] [[probe:noscroll]]'s Hercules list box shows USER's gray arrows pixel for pixel.
- [[read out]] **With both off**, there is no thumb. The track is not the scroll bar colour but a class background: the control's parent's, or, for a window's own bar, the window's class's. A class without a background gives the window colour. No `WM_CTLCOLOR` is sent (seg18 `02da`, `03cf`).
- [[measured]] So the track is white in the probe, whose window class has the window colour, and in a list box, whose class has none.
- [[read out]] `SetScrollPos` still moves a bar whose arrows are off. [[probe:noscroll]] moves a disabled control from 3 to 7.
- [[read out]] A list box with `LBS_DISABLENOSCROLL` keeps its scroll bar. When everything fits it turns both arrows off, rather than taking the bar away, and leaves the position as it was (seg43 `0088`). `COMMDLG`'s file lists are made so.
- [[read out]] A click on an arrow that is off is ignored. With one arrow off, the track, the thumb and the keyboard still work.

## Not yet done

- Dragging the thumb and pressing the arrows.
- `ShowScrollBar`.
- Redrawing a disabled control right away from `SetScrollPos`, which draws a thumb on the track (seg18 `0c56`).
- Shrinking by more than a pixel, in either of GDI's stretch engines.

## In winbox.js

`src/win16/user/scroll-bars.ts` keeps the ranges, positions and arrows turned off, for windows and for controls. `Painter.scrollBar` in `src/win16/user/painter.ts` draws the thumb where they put it, and `frame.ts` lays the bars out.
