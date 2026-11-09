---
kind: function
module: USER
name: DragObject
ordinal: 464
summary: Drags an object over windows that may take it, asking each under the cursor, and answers what the one it is dropped on answers.
versions:
  '3.1': exact
probes: [dragobj]
source: crates/winbox-win16/src/drag_object.rs
topics: [user-internals, mouse-input]
---

## Observed behaviour

- [[measured]] [[probe:dragobj]], a move and a release posted with the cursor over a child: the windows are asked from the parent given down, the child first -- `WM_QUERYDROPOBJECT` with `wParam` nought and a `DRAGINFO` whose source, format and data are as given, its scope the child and its point the child's client coordinates; the source is sent `WM_DRAGLOOP` with 1 while a window takes it; the child that takes it `WM_DRAGSELECT` 1 once and `WM_DRAGMOVE` after; the release ends the drag and the child is sent `WM_DROPOBJECT` with the source in `wParam`, and what it answers is answered. A child that answers nought is passed over for its parent; where none takes it, `WM_DRAGLOOP` is sent with nought, the scope nought and the point the screen's, nothing is dropped, and nought is answered. A cursor's handle answered takes the object as 1 does. The capture is let go after.

## Inside Windows

- [[read out]] `USER.EXE` seg14 `0fbe` checks the two windows and the cursor and enters `00f2`: a block of 24h bytes, `GMEM_DDESHARE | GMEM_ZEROINIT`, the `DRAGINFO` -- source at 0, scope at 2, format at 4, data at 6, point at 0Ah -- with a copy at 12h; USER's cursor 100, the no-drop cursor, loaded; the cursor given made a monochrome cursor of the system's size where it is not one (seg13 `053e`) and set; `SetCapture` of the source and `ShowCursor(TRUE)`.
- [[read out]] The loop (`01bf`-`02f4`): a mouse message taken, else `WM_QUEUESYNC`, else a key's, else `WaitMessage`; the block copied to 12h and the point set from the message; the hit test from the parent (`0000`); the cursor the no-drop one for nought, the given one for 1, else the handle answered; `WM_DRAGLOOP` to the source; a new scope `WM_DRAGSELECT` -- nought to the old with the copy, 1 to the new -- else `WM_DRAGMOVE`; `WM_LBUTTONUP` or `WM_NCLBUTTONUP` ends it.
- [[read out]] The hit test (`0000`-`00ef`): nought outside the window or for a disabled one; a minimized window, or a point outside the client area, asks the window itself with `wParam` 1; else the first visible child the point is in, unless disabled, is asked first; a window asked is the scope and gets the point in its client's coordinates, put back where it answers nought.
- [[read out]] After (`02f7`-`035b`): `ReleaseCapture`, `ShowCursor(FALSE)`, the cursor before put back and a made one destroyed; where the last cursor was not the no-drop one, `WM_DROPOBJECT` to the scope with the source, its answer in DX:AX; the no-drop cursor and the block freed.

## Callers

- [[read out]] `WINFILE.EXE` and `PROGMAN.EXE` import it (`kb/data/user-callers.json`); no corpus program does.

## Implementation

`src/win16/user/drag-object.ts`; the Rust engine's `crates/winbox-win16/src/drag_object.rs`, each making its calls through USER's and KERNEL's own exports. WinBox keeps no picture of USER's cursor 100: a handle of its own stands for it, drawn as the arrow, and the cursor given is shown as it is, not first made a monochrome cursor of the system's size. Neither picture reaches a program.
