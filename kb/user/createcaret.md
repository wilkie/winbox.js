---
kind: function
module: USER
name: CreateCaret
ordinal: 163
summary: Makes the system's one caret for a window, a rectangle of the given size that starts hidden and blinks by inverting what is under it.
versions:
  '3.1': exact
probes: [editctl, dialogs]
source: src/win16/user/caret.ts
topics: [edit-controls]
---

## Observed behaviour

- [[documented]] There is one caret for the whole system. Making one for a window takes the place of any caret before it. A width or height of nought is the width or height of a window border.
- [[documented]] The caret starts hidden. `ShowCaret` shows it, and each `HideCaret` must be undone by a `ShowCaret` before it shows again.
- [[measured]] The caret inverts what is under it: over the black text of an edit control it is white. [[probe:editctl]] records it by reading the control with the caret shown and again after `HideCaret`, on four displays.
- [[measured]] It blinks every 530 milliseconds, which is what `GetCaretBlinkTime` answers before anything sets it.
- [[measured]] `GetCaretPos` answers where `SetCaretPos` put it, in the window's client coordinates.
- [[documented]] `BeginPaint` hides the caret of the window being painted, and `EndPaint` shows it again.

## Nuances

- Not yet measured: a caret made from a bitmap or grey (`hbm` 1), which winbox.js draws solid.
- The blink is a system timer. A program's loop takes and dispatches it as `WM_SYSTIMER`, 118h, which calls the caret's own procedure.

## Implementation

`src/win16/user/caret.ts` holds `CreateCaret`, `DestroyCaret`, `SetCaretPos`, `GetCaretPos`, `HideCaret`, `ShowCaret`, `SetCaretBlinkTime` and `GetCaretBlinkTime`. The caret inverts its rectangle of the window's client area with the raster operation `DSTINVERT`. Under a replay's virtual clock, where every timer is always due, it does not blink. Before this, all eight were stubs.
