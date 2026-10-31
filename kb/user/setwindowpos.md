---
kind: function
module: USER
name: SetWindowPos
ordinal: 232
summary: Moves, sizes, shows, hides or puts a window elsewhere in the order of windows; a window moved takes its bits with it, and what it uncovers is drawn again.
versions:
  '3.1': exact
probes: [swpbits, swporder, uncover, uncovr2, showseq, defer, mousemsg, vismove, swpunc, swpunc31]
source: src/win16/user/window-state.ts
topics: [painting, visible-regions]
---

## Observed behaviour

### Moving and sizing

[[probe:swpbits]] moves a pop-up, 200 by 100 and black where it paints, over a light grey window that covers the screen. It reads the screen at once, then after taking its messages, and logs what each window is sent. [[measured]]

- **The bits go with the window.** Moved, the window shows whole at its new place before the call answers, and it is sent nothing to paint: no `WM_NCPAINT`, no `WM_ERASEBKGND`, no `WM_PAINT`. `GetUpdateRect` finds nothing due. A window with a caption is the same, and so is a child moved in its parent, by `SetWindowPos` or [[fn:USER.MoveWindow]].
- **What could not come with it is due.** Where another window lay over part of it, that part is due at its new place and erased at once, and nothing else of it.
- **`SWP_NOCOPYBITS`**: what of the new place already showed the window is left as it is, and only the rest is due -- the at-once erase leaves the overlap black from before. That is not a rule of its own: the call copies through the rectangle the call before it left in USER's entry (below, _The entry's rectangle_), here the window's own place as it was shown.
- **Sized, the client area's bits go with the client area**, and the rest is due. Made larger, the window is sent `WM_NCPAINT` and `WM_ERASEBKGND` for the new strips; made smaller, nothing at all. With `CS_HREDRAW` and a new width, or `CS_VREDRAW` and a new height, all of it is due. Moved only, the two styles change nothing.
- **`MoveWindow` with `bRepaint` FALSE does just what it does with TRUE.**
- **What it uncovered is due in the windows that show there now, and no more.** A window lying over its old place is not. The window beneath is sent `WM_NCPAINT` and `WM_ERASEBKGND` at once, and `WM_PAINT` for the box of what it uncovered, `fErase` nought. A child moved in its parent leaves the parent `WM_ERASEBKGND` only. With `SWP_NOCOPYBITS`, a parent without `WS_CLIPCHILDREN` is due where the child is due as well.
- **The erases come before `WM_WINDOWPOSCHANGED`.** The order is `WM_WINDOWPOSCHANGING`, `WM_NCCALCSIZE` when a size is given, the moved window's own erase, the erases of the windows uncovered, then `WM_WINDOWPOSCHANGED`, `WM_MOVE` and `WM_SIZE`.

### What is copied, and what is made due

[[read out]] `USER.EXE` seg7 `0526`, once for all the windows of the call (`EndDeferWindowPos`'s list; `SetWindowPos` is a list of one):

- **Nothing is drawn** where the parent of the first window does not show (seg7 `0557`-`0560`, seg1 `1802`), nor where every window is asked for nothing (`09a0`-`0a2d`: each window's flags against 18E7h). A window with `SWP_NOREDRAW` is passed over (`05c7`).
- **Before anything moves**, each window's **visible region as it was** (`09a0`-`0a1a`): nothing for a window hidden, else USER's rule for its whole window with `DCX_CLIPSIBLINGS` where it has `WS_CLIPSIBLINGS`, its children not taken out (`0c19`-`0c46`: the call at `0c41` is seg1 `1582` with `DCX_WINDOW`, or 11h; [[topic:visible-regions]]). Then the windows are placed (`0a33`): each window's update region goes with it as far as its bits do, and so do its children with theirs (`0b1a`-`0b41`, seg2 `0a1d`); USER's contexts in the parent made stale (`0595`, seg1 `8aa0` with 4 for a parent with `WS_CLIPCHILDREN`, else 2). Then, window by window, its **visible region as it is now** (`05e0`).
- **What is copied** (`060b`-`0768`), where neither region is empty, the window is not due all over and the rectangle its bits go to is not empty: that rectangle, moved back to where they come from (`062d`-`064d`, `SetRectRgn`), within the old visible region (`0652`); less what the windows before it in the list copied (`066e`-`068c`); moved to where the bits go (`068e`-`06a0`); less the window's update region and its parents', up to one with `WS_CLIPCHILDREN`, whose is not taken, and nothing at all where one of them is due all over (`06a5`-`06e9`); within the new visible region (`06eb`-`0705`). Each step leaving nothing copies nothing. It is blitted through a screen context (seg1 `8448`) whose visible region it is, `SRCCOPY` from where the bits come (`0727`-`0768`), only where they move; the context's region is set back after the list (`0972`-`0992`). The windows in it are copied as they are, what they are due included.
- **What is made due** (`07f5`-`092a`): the old visible region and the new together (`0815`-`0828`, `0c4b`: the other where one is empty, nothing where both are), less what every window so far copied (`082a`-`088c`), gathered for the list (`08f5`-`092a`). A window nothing of which was copied, that shows now, is made due all over through itself -- seg1 `3ed7` with all of it and `RDW_INVALIDATE | RDW_ERASE | RDW_FRAME | RDW_ALLCHILDREN`, 485h (`08de`-`08f0`): `WM_NCPAINT` with 1. What was gathered is made due through the parent of the first window by the same walk with `RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN`, 85h -- or `RDW_NOCHILDREN`, 45h, where every window of the list was shown and is of a program made before 3.10, counted at `08c6`-`08d5` (`SWP_SHOWWINDOW`, and the window's bit 4 of the byte at 26h clear: `CreateWindow` sets it where `GetExpWinVer` answers 30Ah or more, seg8 `0425`-`0432`; a window with `SWP_NOREDRAW` is not counted, `05c7`) -- (`0939`-`0958`). How the parent passes it on is the walk's ([[fn:USER.InvalidateRgn]]): a parent without `WS_CLIPCHILDREN` is given all of it, where its children show too; with `RDW_NOCHILDREN` the parent alone is given it -- the desktop, which draws nothing where a window shows.
- A window whose class saves the bits beneath it (`CS_SAVEBITS`, its byte at 24h) has them put back where it uncovered them instead (`076d`-`07f3`, seg13 `211e`): not followed ([[topic:visible-regions]]).
- Where a window is locked ([[fn:USER.LockWindowUpdate]]), the window's old and new places, and what every context drew, are told to the lock (`09c2`-`09d5`, `057a`, `05f0`-`0606`).
- **Then it is drawn at once** (seg7 `0274`-`028d`), where something was drawn and the parent of the first window shows: seg1 `7913` from that parent with `DSP_ENUMCLIPPEDCHILDREN`. A window whose paint waits for a window it is in -- one up to the first with `WS_CLIPCHILDREN` that has an update region -- is passed over, and the windows in it (`798d`-`799f`, `7a64`). A window due its frame is sent `WM_NCPAINT` with a copy of its update region, or 1 for all of it, and the region is then cut to its client area -- nothing left, it is due no paint (`7930`-`7947`, `7ba0` with 1, `7b52`); one due an erase, where it had an update region, is erased through USER's context for its client area with `DCX_INTERSECTRGN` of that copy (`794a`-`7961`, `7a83`: `GetDCEx` with 50080h, given back as `EndPaint` gives it). A window of another task is sent `WM_SYNCPAINT` instead (`79e6`-`7a02`). Then the windows in it, front to back, where it has `WS_CLIPCHILDREN` -- the desktop has -- a child of another task passed over (`796a`-`797f`, `7a04`-`7a59`). So a child is erased at once in a parent with `WS_CLIPCHILDREN`, and waits for its `BeginPaint` in one without.

_The entry's rectangle._ [[read out]] `BeginDeferWindowPos` hands out a block of four entries USER keeps, for four windows or fewer while no call has it (seg7 `00d7`-`00e4`, its word at 7CCh), else a block made afresh, all noughts (`00e6`-`00ef`); `SetWindowPos`, and so `ShowWindow`, go through it. `DeferWindowPos` writes an entry's first fields only (`01c4`-`01ea`), and where the bits go (+16h) is written as the call works each window out (`0ca3`): a window moved and not sized, without `WM_NCCALCSIZE`, its whole window (`1028`-`104c`) -- but with `SWP_NOCOPYBITS`, nothing, so the rectangle the call before left in that entry stays, and the copy goes through it; with `WM_NCCALCSIZE` sent, nothing with `SWP_NOCOPYBITS` (`0fed`, `1158`), else the client area as it kept it (`10a7`-`1153`, below). The second block, of two at A3Ch, handed out while USER's word at E0h is set (`00c0`-`00cd`), is not followed.

[[probe:swpunc]] records what is copied and made due in each of the cases above, with windows whose paint and erase draw nothing, filled black or white, and logs each window's update region as the call answers, the screen over the windows, and `WM_NCPAINT`, `WM_ERASEBKGND` and `WM_PAINT` in order, during the call and as the messages are taken after: [[measured]]

- **Siblings without `WS_CLIPSIBLINGS`**: a child moved takes with it what its sibling drew over it; with `WS_CLIPSIBLINGS`, not. Either way the parent is due all of where it was, and erased at once; the sibling is due where it lay in that place, erased as it paints.
- **A parent with and without `WS_CLIPCHILDREN`** alike: due where the child was, and erased at once; a sibling the child now lies over, nothing.
- **`SWP_NOCOPYBITS`** with a window over it: nothing copied, the window due all over, `WM_NCPAINT` with 1. With nothing over it, the copy went through the entry's rectangle: only its new place less its old is due, `WM_NCPAINT` with a region, and its erase's context has that for its visible region.
- **A program made for 3.10** ([[probe:swpunc31]], the same cases from a program so marked): two hidden children shown together, or one shown by `SetWindowPos`, in a parent with `WS_CLIPCHILDREN`, leave the child under them due where they show, erased at once (85h, not 45h); a child shown again in a pop-up without `WS_CLIPCHILDREN` leaves the sibling under it due there, erased as it paints. Everything else is as above.
- **`DeferWindowPos`**: two children moved in a parent with `WS_CLIPCHILDREN`: the parent due both old places, a third child under them nothing. Two hidden children shown together: the parent due where they show, its paint's clip box empty; the child under them nothing (45h); each shown child sent `WM_NCPAINT` with 1 and erased at once. One shown and one moved: the child under the one shown is due where it shows too, and erased at once (85h).
- **A window due part of itself, moved**: that part goes with it and is not copied there; the window under it is due what it uncovered, `WM_NCPAINT` with a region. **Due all over**: nothing copied, `WM_NCPAINT` with 1.
- **A child of a child moved**: its parent is due where it was, cut to its client area as `GetUpdateRgn` gives it, with or without `WS_CLIPCHILDREN`; the grandparent nothing. With the grandparent due a part of itself as it moves, that part is all it is due.
- **Hidden and shown**: a pop-up hidden leaves the window under it due where it was, `WM_NCPAINT` with a region; shown, it is due all over, `WM_NCPAINT` with 1. A child hidden leaves its parent due all of where it was, erased at once, and a sibling under it due there, erased as it paints; shown again, its parent is due where it shows, erased at once, and it all over, `WM_NCPAINT` with 1.
- **Sized with `CS_HREDRAW` or `CS_VREDRAW`** and a new width or height: due all over, `WM_NCPAINT` with 1. Without, made larger: due the new strips, `WM_NCPAINT` with a region; made smaller: `WM_NCPAINT` with a region and an erase, nothing left due, and the window beneath due what it uncovered.

[[probe:vismove]] holds the corners to the pixel, with windows that neither paint nor erase: [[measured]]

- A pop-up partly under another, moved: what showed of it comes with it, where it shows now; nothing of it is due, nor of the window over it.
- A child moved to where its parent, without `WS_CLIPCHILDREN`, is due: that part of its bits is not copied, and the child is due there; the parent is due where the child was and where it was due.
- A child moved with a child of its own due all over: the grandchild's pixels come with it, and it stays due, where it is now; the child is due nothing, the parent where the child was.
- A child without `WS_CLIPSIBLINGS` moved from under a sibling without it that drew over it: the sibling's pixels over it come with it. The parent is due all of where it was, the sibling where it lay over it.

### The order of windows

[[probe:swporder]] stacks four pop-ups, each over the one before, and puts them elsewhere one call at a time with `SWP_NOMOVE | SWP_NOSIZE`. After each it lists the order, the active window and what was sent. Then it does the same with three children. [[measured]]

- **`HWND_BOTTOM`** puts the window behind every other, hidden ones too. A topmost window put there is topmost no more.
- **A window given** puts it right after that one. After a topmost window, it becomes topmost.
- **`HWND_TOPMOST`** makes it topmost, in front of all. **`HWND_NOTOPMOST`** makes a topmost window not, and puts it in front of those that are not. A window that was not topmost stays where it is.
- **Made active**, without `SWP_NOACTIVATE`, a window at the top comes to the top whatever it was asked, unless it was `HWND_TOPMOST`. Asked for the bottom and made active, it stays at the top.
- **`WM_WINDOWPOSCHANGING` carries the window it goes after as USER worked it out.** For a window that is not topmost, `HWND_TOP` is the last topmost window: USER's own hidden `#32771`, as [[probe:showseq]] recorded for a window shown. `HWND_TOPMOST` is `HWND_TOP`. `HWND_NOTOPMOST` is the last topmost window, or, for a window that is not topmost, the one in front of it.
- **Put after itself, it is sent nothing at all,** and the call answers 1. So is a child given `HWND_TOPMOST`.
- **`WM_WINDOWPOSCHANGED` follows only where its place in the order, or whether it is topmost, changed.** Asked for where it already was, it is sent `WM_WINDOWPOSCHANGING` alone.
- **What a change uncovers is drawn again.** A window brought up from beneath another is sent `WM_NCPAINT` and `WM_ERASEBKGND` at once, and `WM_PAINT` for that other's place. A window sent to the bottom leaves each window it covered the same.
- **Children without `WS_CLIPSIBLINGS` are not drawn again** for being put in front of their brothers or behind: they draw over one another.

winbox.js agrees with all 72 records of `swpbits` and all 78 of `swporder` on both engines. Both engines had repainted a moved window whole. Worse, they had held its paint to its old place, so a window dragged by its caption showed only where its old and new places met. Of the windows to go after, they had followed only `HWND_TOP`.

### Showing a window

[[probe:swpshow]] shows five hidden pop-ups that nothing owns, while another window is active, each with one `SetWindowPos` with `SWP_NOMOVE | SWP_NOSIZE`. Then it shows three of them again from a window's `WM_SIZE` as the window is restored from an icon, as SimTower shows its palettes. [[measured]]

- **`SWP_SHOWWINDOW` with `SWP_NOACTIVATE` makes nothing active.** The window shown goes where it was asked, and the active window stays active. [[read out]] Only the first window of the list without `SWP_NOACTIVATE` is made active (`USER.EXE` seg7 `0cda`-`0ce6`, `0260`-`026f`).
- **Without `SWP_NOACTIVATE`, the window shown is made active** and comes to the top, as `ShowWindow` brings it.
- **It is drawn at once**: `WM_NCPAINT` with 1 and `WM_ERASEBKGND` come before `WM_WINDOWPOSCHANGED`.
- **Already where it was asked to go, it is told so**: `WM_WINDOWPOSCHANGED` has `SWP_NOZORDER` added, though `WM_WINDOWPOSCHANGING` did not (seg7 `0e09`-`0e38`, `1184`).

winbox.js agrees with these records on both engines. It had made every window shown so active, and brought it to the very front. [[topic:creating-and-showing]] has what is not yet followed.

## Implementation

`positionChanging` and `positionChanged` in `src/win16/user/window-state.ts`; `insertFor`, `reorder`, `moveWithBits` and `placeShown` in `src/win16/user/desktop.ts`; `syncPaintFrom` in `src/win16/user/erase.ts`. The Rust engine's are in `crates/winbox-win16/src/position.rs`, `moved.rs` (`move_with_bits`, `placed_shown`) and `paint.rs` (`sync_paint_from`). A window moved or sized works out its visible region before and after by USER's rule, copies through the two, and makes what is left due by USER's walk through itself and its parent, as read out above; a child shown or hidden the same, nothing copied. Each window of a list is drawn as it is placed, not all of them after all are placed: what the windows before it copied is not taken out, and each is walked through its parent alone. `RDW_NOCHILDREN` is chosen for the list as a whole, as `08c6` counts it. The entry's rectangle is kept for the four entries, written by `SetWindowPos`, `EndDeferWindowPos` and `ShowWindow` (`deferSlots`, `System::defer_slots`). Both engines agree with all 225 records of [[probe:swpunc]], and as before with [[probe:swpbits]], [[probe:vismove]], [[probe:swporder]], [[probe:swpframe]], [[probe:nccalc]], [[probe:defer]] and [[probe:showseq]].

A window at the top shown or hidden by `ShowWindow`, `SetWindowPos` or `DestroyWindow`, or put elsewhere in the order of windows, is still drawn by WinBox's own rule, the screen's owners: what it uncovers due in the windows that show there now ([[topic:visible-regions]], "Not yet done").

Not measured: what `SWP_NOREDRAW` leaves undrawn beyond `MoveWindow`, and whether a call that asks for nothing at all sends anything.
