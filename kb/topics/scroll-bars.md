---
kind: topic
name: Scroll bars
summary: A window's scroll bars in Windows 3.1 — their ranges and positions, and where the thumb is drawn — read out of USER.EXE and measured through a multi-line edit control on four displays.
probes: [mledit, chrome]
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

## Not yet done

Dragging the thumb and pressing the arrows, `EnableScrollBar`'s disabled arrows, and `ShowScrollBar`.

## In winbox.js

`src/win16/user/scroll-bars.ts` keeps the ranges and positions. `Painter.scrollBar` in `src/win16/user/painter.ts` draws the thumb where they put it, and `frame.ts` lays the bars out.
