---
kind: function
module: USER
name: ScrollWindow
ordinal: 61
summary: Moves what a window's client area shows by an amount, leaves what the move uncovers as it was, and marks it to be painted; ScrollWindowEx and ScrollDC do the same with more said and less done.
versions:
  '3.1': exact
probes: [scrolls]
source: src/win16/user/scroll-window.ts
topics: [painting, scroll-bars]
---

## Observed behaviour

[[probe:scrolls]] fills a window 32 by 24 with blocks of colour 4 by 4 and scrolls it. Its class has no background and its paint draws nothing, and no message is dispatched before the probe reads every pixel back. So what it reads is what the scroll left. [[measured]]

- **What moves.** The pixels inside both the scroll rectangle and the clip rectangle move by the amount asked. The scroll rectangle is the whole client area when none is given, and so is the clip. They land only inside the clip, and nothing is brought in from outside it.
- **What is left.** The pixels the move uncovers keep what they showed. Nothing erases them until the window is painted.
- **What is to be painted.** The scroll rectangle cut to the clip, less where its pixels went. For a move both across and down that is an L, a complex region, whose box is the whole of it. `ScrollWindow` marks that for painting, and [[fn:USER.GetUpdateRect]] answers its box.
- **Children.** With no scroll rectangle, the window's children move with its pixels; with one, they stay.
- **ScrollWindowEx** moves the pixels the same way. It marks the update for painting only with `SW_INVALIDATE`, and moves the children only with `SW_SCROLLCHILDREN`. It answers the update region's kind, 3 for the L, whether it marks it or not, and gives the region and its box.
- **ScrollDC** moves the pixels of a device context the same way, marks nothing, and answers TRUE with the region and its box.

winbox.js agrees with all 234 records. All three were stubs that did nothing.

## Nuances

- Not recorded: what a child moved by a scroll is sent (winbox.js sends nothing); the pixels of a window that another window covers, which winbox.js scrolls as they show on the screen; and whether the update is erased, which winbox.js takes from the documentation: `ScrollWindow` erases, `ScrollWindowEx` only with `SW_ERASE`.
- winbox.js keeps what a window has to paint as one rectangle, so the L's box is painted, not the L alone.
