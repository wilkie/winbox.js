---
kind: function
module: COMMDLG
name: Ordinal 32
ordinal: 32
summary: COMMDLG's wait cursor: the hourglass while a dialog works, the arrow when it is done, and the cursor shown and hidden where no mouse was present as COMMDLG loaded.
versions:
  '3.1': stub
topics: [common-dialogs]
---

## Observed behaviour

- [[read out]] One word, whether COMMDLG is busy (`COMMDLG.DLL` seg2 `08e2`, `retf 2`). Not nought, the cursor is `LoadCursor(0, IDC_WAIT)`; nought, `IDC_ARROW`; either is given to `SetCursor`.
- [[read out]] While the Open or Save As box is being made (`[0CACh]` set around its `WM_INITDIALOG`, seg2 `4354`, `4577`), it does nothing at all.
- [[read out]] Where `GetSystemMetrics(SM_MOUSEPRESENT)` was nought as COMMDLG loaded (`[0D1Ah]`, seg7 `00e3`), it first calls `ShowCursor` with the same word, so the cursor shows only while it is the hourglass.
- It answers nothing.

## Nuances

- [[read out]] Its callers: [[fn:COMMDLG.GetOpenFileName]]'s start and end (seg2 `0a25`, `0bf5`) and the file dialogs' longer steps (seg2 `2e94` onwards); the Color dialog's `WM_INITDIALOG` and Define Custom Colors (seg1 `0278`, `0292`, `0d01`, `0dea`); and [[fn:COMMDLG.PrintDlg]] and its dialogs (seg3 `0cb2` onwards). The Font dialog sets the cursor itself ([[topic:choose-font]]).
- [[read out]] The entry table gives it flags 0, where every named export has 3 (exported, shared data): it is an entry point for COMMDLG's own far calls into a moveable segment, which the linker must route through the entry table, not a function COMMDLG offers programs. Its callers reach it by a relocation naming the ordinal ([[topic:common-dialogs]]).

## Inside Windows

[[read out]] seg2 `08e2`: `cmp [0CACh], 0`, then `[0D1Ah]` and `ShowCursor`, then `LoadCursor(0, 7F02h or 7F00h)` and `SetCursor`.

## Implementation

Not WinBox's own: ordinal 32 is a stub in WinBox's table (`src/win16/commdlg/index.ts`, named `Unknown`, popping 2 bytes, as the entry's `retf` does), and the Rust engine has no arm for it (`crates/winbox-win16/src/commdlg/mod.rs`). With `COMMDLG.DLL` on the drive the file's own code runs it for the file's own callers, whose calls between their functions stay the file's. WinBox's own dialogs set the cursor as it does with a helper of their own, `waitCursor` in `src/win16/commdlg/state.ts` and `wait_cursor` in the Rust engine, which skips the same case of the Open or Save As box being made. WinBox always has a mouse, so it never shows or hides the cursor.
