---
kind: function
module: USER
name: SetWindowPos
ordinal: 232
summary: Moves, sizes, shows, hides or puts a window elsewhere in the order of windows; a window moved takes its bits with it, and what it uncovers is drawn again.
versions:
  '3.1': exact
probes: [swpbits, swporder, uncover, uncovr2, showseq, defer, mousemsg]
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

`positionChanging` and `positionChanged` in `src/win16/user/window-state.ts`; `insertFor`, `reorder` and `moveWithBits` in `src/win16/user/desktop.ts`. The Rust engine's are in `crates/winbox-win16/src/position.rs` and `moved.rs`. The desktop knows which window shows at each pixel. A pixel the window shows after the move is valid where the window, or the same child of it, showed the pixel it comes from. Valid pixels are copied; the rest are due as a region.

Not measured: what `SWP_NOREDRAW` leaves undrawn beyond `MoveWindow`, and whether a call that asks for nothing at all sends anything.
