---
kind: function
module: USER
name: ScrollWindow
ordinal: 61
summary: Moves what a window's client area shows by an amount, through what shows of it, leaves what the move uncovers as it was, and marks it to be painted; ScrollWindowEx and ScrollDC do the same with more said and less done.
versions:
  '3.1': exact
probes: [scrolls, visscrl]
source: src/win16/user/scroll-window.ts
topics: [painting, scroll-bars, visible-regions]
---

## Observed behaviour

[[probe:scrolls]] fills a window 32 by 24 with blocks of colour 4 by 4 and scrolls it. Its class has no background and its paint draws nothing, and no message is dispatched before the probe reads every pixel back. So what it reads is what the scroll left. [[measured]]

- **What moves.** The pixels inside both the scroll rectangle and the clip rectangle move by the amount asked. The scroll rectangle is the whole client area when none is given, and so is the clip. They land only inside the clip, and nothing is brought in from outside it.
- **What is left.** The pixels the move uncovers keep what they showed. Nothing erases them until the window is painted.
- **What is to be painted.** The scroll rectangle cut to the clip, less where its pixels went. For a move both across and down that is an L, a complex region, whose box is the whole of it. `ScrollWindow` marks that for painting, and [[fn:USER.GetUpdateRect]] answers its box.
- **Children.** With no scroll rectangle, the window's children move with its pixels; with one, they stay.
- **ScrollWindowEx** moves the pixels the same way. It marks the update for painting only with `SW_INVALIDATE`, and moves the children only with `SW_SCROLLCHILDREN`. It answers the update region's kind, 3 for the L, whether it marks it or not, and gives the region and its box.
- **ScrollDC** moves the pixels of a device context the same way, marks nothing, and answers TRUE with the region and its box.

[[probe:visscrl]] scrolls a pop-up of black squares on white, part of which another pop-up covers, and reads the screen and the update region after each call. [[measured]]

- **Only what shows is copied, and only to where it shows.** The covering window's pixels stay as they were; nothing of them is brought into the scrolled window. Where the pixels would have come from under it, the window is left as it was and that part is to be painted.
- **The update is what shows of the source and of the destination, less what was copied**, in the window's terms -- not what lies under the other window.
- **What the window was due.** Before `ScrollWindow` it stays due, and the box of it, moved by the scroll, is made due as well. Before `ScrollWindowEx` it stays due where it was, and its pixels, where it was and where they would go, are not copied: they are in the update the call answers.
- **Clipped clear of the other window**, so that what shows is one rectangle, a move one way answers a rectangle, kind 2; a move both ways a region; a source and destination apart, the source.
- **Nothing to move**, `ScrollWindowEx` answers 1 and an empty update.
- **Children.** `ScrollWindow` with no scroll rectangle moves the children with the pixels, sends each `WM_MOVE` after, and leaves them due nothing. With a scroll rectangle they stay, and a child the update reaches is due: [[fn:USER.GetUpdateRect]] answers all of it, the box of the parent's update cut to the child. `ScrollWindowEx` with `SW_SCROLLCHILDREN` and a scroll rectangle moves the children it meets and sends no `WM_MOVE`.
- **The caret** moves with the pixels where the children do and it lies in what moves.

## Inside Windows

[[read out]] `USER.EXE` seg13. `ScrollWindow` (`127a`) is `ScrollWindowEx`'s body with `SW_INVALIDATE | SW_ERASE`, `SW_SCROLLCHILDREN` where no scroll rectangle is given, and a flag of its own, 8000h.

`ScrollDC`'s body (`178d`), on a context:

1. The clip box is asked (`179f`). Nothing visible: the update empty and 1. The scroll rectangle is the one given, or the clip box; with the clip rectangle, all into device terms for `ScrollDC` and for `ScrollWindowEx` without `SW_INVALIDATE` (`17ea`-`1855`).
2. Where what shows is one rectangle -- cut to the clip rectangle -- and the window has no update region or is due all over, the rectangles alone (`1984`-`1b62`): source and destination cut to the clip box; what moves, the source moved within the destination, none where the window is due all over; the update the two together less what moves (`SubtractRect`), but a region where the move is both ways, or the two are apart and the source was cut.
3. Otherwise, by regions (`1bc4`-`1def`): what shows is the visible region within the clip region, in the context's terms (`1e19`: `InquireVisRgn`, `GetClipRgn`, `GetDCOrg`), within the clip rectangle; the source and the destination within it; what moves, the source moved within the destination, less the window's update region and less it moved; the update the source and destination less what moves. **The pixels are blitted through what moves, selected as the visible region** between `SaveVisRgn` and `RestoreVisRgn` -- what another window covers is neither read nor written.
4. It answers the update region's kind, the update rectangle in logical terms.

`ScrollWindowEx` (`12f3`):

- Nothing to move, or the window not shown (seg1 `1c5f`): an empty update, 1.
- The caret hidden while its window is the window or one the window is in (`1332`-`134e`), shown after.
- A context of the client area: common, with `DCX_USESTYLE`; for `ScrollWindow` the window's own where its class has one; with `SW_SCROLLCHILDREN`, `GetDCEx`'s 80000h, which leaves the children's pixels in (`1362`-`13d2`, seg1 `84ff`).
- No scroll rectangle: the client area, in the own context's logical terms (`13f8`-`1421`).
- `ScrollWindow` first makes the box of what the window was due, moved by the scroll, due too (`1497`-`14db`), and gives the body no update region; `ScrollWindowEx` gives it the window's (`14e2`).
- With `SW_SCROLLCHILDREN` (`15a2`-`1666`): the caret moved if it is the window's and meets the scroll rectangle; the children meeting the scroll rectangle -- and theirs, by the same rectangle -- moved, with what they are due (seg2 `0a1d`); the window's contexts made stale (seg1 `8aa0`, 4 or 2 by `WS_CLIPCHILDREN`).
- With `SW_INVALIDATE`, the update made due through the window and its children, `RDW_INVALIDATE | RDW_ALLCHILDREN`, `RDW_ERASE` with `SW_ERASE` (`166b`-`16af`).
- Then each child meeting the scroll rectangle moved by **the parent's** client area's corner -- the window's own only for a window at the top -- is sent `WM_MOVE` (`16c3`-`1742`).

How a region is made due through a window and its children (seg1 `3ed7`, `4034`, `4202`): a window is passed over where its rectangle, cut to the client areas it is in, meets nothing of the region; covered all over by it, it is due all over, and so are those in it. It is given the region whole, not cut to itself -- what `GetUpdateRect` cuts the box of to its client area. Without `WS_CLIPCHILDREN` it is given it before its children, with it after them. Its children are walked front to back where it has any, is not minimized, `RDW_NOCHILDREN` is not given, and `RDW_ALLCHILDREN` is or it has no `WS_CLIPCHILDREN`, each told to erase and draw its frame too; one with `WS_CLIPSIBLINGS` whose parent has `WS_CLIPCHILDREN` takes its rectangle out of the region for those behind it and for its parent.

## Nuances

- [[read out]] The children moved are sent `WM_MOVE` only where they meet the scroll rectangle moved by the parent's client area's corner, not the window's: a child window's scroll rectangle is tested in the wrong place. [[measured]] With a pop-up at (300, 100) and a scroll rectangle of its client area, the child moved is sent no `WM_MOVE`.
- [[read out]] For a window with a context of its own, `ScrollWindow` takes the amount and the rectangles in that context's logical terms (`1447`-`148e`). Not recorded.
- Whether the update is erased: `ScrollWindow` erases, `ScrollWindowEx` with `SW_ERASE`, as read out.

## Implementation

Both engines as read out: `src/win16/user/scroll-window.ts` and `src/win16/user/invalidate-through.ts`; `crates/winbox-win16/src/user_calls/scroll_window.rs` and `invalidate_through.rs`. A blit whose source is its destination's own pixels reads them all first, as the display driver copies the right way round ([[fn:GDI.BitBlt]]). Both agree with all 234 records of [[probe:scrolls]] and all 60 of [[probe:visscrl]]. They had copied what showed on the screen over the window -- the covering window's pixels -- and given the scroll rectangle less the move as the update.
