---
kind: function
module: USER
name: SetWindowPos
ordinal: 232
summary: Moves, sizes, shows, hides or puts a window elsewhere in the order of windows; a window moved takes its bits with it, and what it uncovers is drawn again.
versions:
  '3.1': exact
probes: [swpbits, swporder, uncover, uncovr2, showseq, defer, mousemsg, vismove]
source: src/win16/user/window-state.ts
topics: [painting]
---

## Observed behaviour

### Moving and sizing

[[probe:swpbits]] moves a pop-up, 200 by 100 and black where it paints, over a light grey window that covers the screen. It reads the screen at once, then after taking its messages, and logs what each window is sent. [[measured]]

- **The bits go with the window.** Moved, the window shows whole at its new place before the call answers, and it is sent nothing to paint: no `WM_NCPAINT`, no `WM_ERASEBKGND`, no `WM_PAINT`. `GetUpdateRect` finds nothing due. A window with a caption is the same, and so is a child moved in its parent, by `SetWindowPos` or [[fn:USER.MoveWindow]].
- **What could not come with it is due.** Where another window lay over part of it, that part is due at its new place and erased at once, and nothing else of it.
- **`SWP_NOCOPYBITS` copies nothing**, and what of the new place already showed the window is left as it is. Only the rest is due: the at-once erase leaves the overlap black from before.
- **Sized, the client area's bits go with the client area**, and the rest is due. Made larger, the window is sent `WM_NCPAINT` and `WM_ERASEBKGND` for the new strips; made smaller, nothing at all. With `CS_HREDRAW` and a new width, or `CS_VREDRAW` and a new height, all of it is due. Moved only, the two styles change nothing.
- **`MoveWindow` with `bRepaint` FALSE does just what it does with TRUE.**
- **What it uncovered is due in the windows that show there now, and no more.** A window lying over its old place is not. The window beneath is sent `WM_NCPAINT` and `WM_ERASEBKGND` at once, and `WM_PAINT` for the box of what it uncovered, `fErase` nought. A child moved in its parent leaves the parent `WM_ERASEBKGND` only. With `SWP_NOCOPYBITS`, a parent without `WS_CLIPCHILDREN` is due where the child is due as well.
- **The erases come before `WM_WINDOWPOSCHANGED`.** The order is `WM_WINDOWPOSCHANGING`, `WM_NCCALCSIZE` when a size is given, the moved window's own erase, the erases of the windows uncovered, then `WM_WINDOWPOSCHANGED`, `WM_MOVE` and `WM_SIZE`.

### What is copied, and what is made due

[[read out]] `USER.EXE` seg7 `0526`, for each window of the call (`EndDeferWindowPos`'s list):

- Before anything moves, the window's **visible region as it was** is worked out by USER's rule, its whole window with `DCX_CLIPSIBLINGS` where it has `WS_CLIPSIBLINGS` and without its children taken out (seg7 `09a0`, `0c19`, seg1 `1582`; [[topic:visible-regions]]). Then the windows are placed (`0a33`): each window's update region goes with it as far as its bits do, and so do its children with theirs (`0b1a`-`0b41`, seg2 `0a1d`). Then its visible region as it is now (`05e0`).
- **What is copied** (`062d`-`076d`): the rectangle the bits go to, moved back to where they come from, within the old visible region; moved to where they go; less the window's update region and its parents' -- the parent's, and the grandparent's, up to one with `WS_CLIPCHILDREN`, whose is not taken -- and nothing at all where one of them is due all over; within the new visible region. It is blitted through a screen context whose visible region it is (`0727`-`0768`). The windows in it are copied as they are, what they are due included. The rectangle the bits go to: with no size change, the whole window; sized, the client area as `WM_NCCALCSIZE` kept it, cut to the old size and aligned as the answer says; nothing with `SWP_NOCOPYBITS`, with `CS_HREDRAW` or `WVR_HREDRAW` and a new width, or `CS_VREDRAW` or `WVR_VREDRAW` and a new height (seg7 `0e8f`-`1166`).
- **What is made due** (`07f5`-`0958`): the old visible region and the new together, less what was copied, made due through the parent with `RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN` -- its children too, `RDW_NOCHILDREN` where every window of the call was only shown. A window nothing of which was copied is made due all over, frame and all (`08de`-`08f0`). How the parent passes it on is `ScrollWindow`'s ([[fn:USER.ScrollWindow]]): a parent without `WS_CLIPCHILDREN` is given all of it, where its children show too.
- Where a window is locked ([[fn:USER.LockWindowUpdate]]), the window's old and new places, and what every context drew, are told to the lock (`09c2`-`09d5`, `057a`, `05f0`-`0606`).

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

`positionChanging` and `positionChanged` in `src/win16/user/window-state.ts`; `insertFor`, `reorder` and `moveWithBits` in `src/win16/user/desktop.ts`. The Rust engine's are in `crates/winbox-win16/src/position.rs` and `moved.rs`. The desktop knows which window shows at each pixel. A pixel the window shows after the move is valid where the window, or the same child of it, showed the pixel it comes from, and where neither the window, where it comes from, nor its parents up to one with `WS_CLIPCHILDREN`, where it goes, are due; nothing is valid where one of them is due all over. Valid pixels are copied; the rest are due as a region, and a parent without `WS_CLIPCHILDREN` is due where it uncovered its other children too. Which window shows at a pixel and the rule's visible region differ only for windows without `WS_CLIPSIBLINGS`, which [[probe:vismove]] agrees in; both engines agree with all 16 of its records.

Not measured: what `SWP_NOREDRAW` leaves undrawn beyond `MoveWindow`, and whether a call that asks for nothing at all sends anything.
