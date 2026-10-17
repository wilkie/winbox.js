---
kind: function
module: COMMDLG
name: Ordinal 53
ordinal: 53
summary: COMMDLG's LibMain, which the entry point calls: it keeps its instance, measures the screen, registers its messages and makes its memory device context.
versions:
  '3.1': stub
topics: [common-dialogs]
---

## Observed behaviour

- [[read out]] `COMMDLG.DLL` seg7 `0155` (`retf 0Ah`): the instance, the data segment, the heap's size and the command line, as a library's `LibMain` is given them. The entry point (seg8) calls it after `LocalInit` ([[topic:dynamic-link-libraries]]).
- [[read out]] In order: `UnlockSegment(-1)`; the instance kept at `[02CAh]`.
- [[read out]] Then seg7 `0000`: `GetSystemMetrics` of `SM_CYCAPTION`, `SM_CYBORDER`, `SM_CXBORDER`, `SM_CYVSCROLL`, `SM_CXVSCROLL` and `SM_CXSIZE`, and `GetSysColor(COLOR_WINDOW)` (`[0D52h]`), the colour the Color dialog erases its luminosity mark with ([[topic:choose-color]]).
- [[read out]] Then seg7 `00e0`: `SM_MOUSEPRESENT` (`[0D1Ah]`, for [[fn:COMMDLG.Ordinal 32]]); `GetVersion`, its bytes swapped (`[0CAEh]`); on a version before 3.10 a byte of its data changed (`[005Ah]` to 5Ch); and the five registered messages `commdlg_LBSelChangedNotify`, `commdlg_ShareViolation`, `commdlg_FileNameOK`, `commdlg_ColorOK` and `commdlg_SetRGBColor`, in that order (seg7 `010b` to `014c`).
- [[read out]] Then whether bit 15 of `GetWinFlags` is set (`[0CA8h]`), `GetSystemMetrics(SM_DBCSENABLED)` (`[0CF2h]`), and with `GetDC(0)`: a compatible memory device context (`[02D0h]`), into which a 1 × 1 compatible bitmap is selected and selected out again, to keep the context's own bitmap (`[02D2h]`); it is given to COMMDLG ([[fn:COMMDLG.Ordinal 43]]) and the screen's context released. Last, `commdlg_help` is registered (seg7 `0208`).
- [[read out]] It answers 1; nought if either of the first two steps, the screen's context or the memory one fails.

## Nuances

- [[read out]] The entry table gives it flags 0, where every named export has 3 (exported, shared data): it is an entry point for COMMDLG's own far calls into a moveable segment, which the linker must route through the entry table, not a function COMMDLG offers programs. Its callers reach it by a relocation naming the ordinal ([[topic:common-dialogs]]).

## Inside Windows

[[read out]] seg7 `0155`; the two steps before it, seg7 `0000` and `00e0`, answer nought or 1.

## Implementation

Not WinBox's own: ordinal 53 is a stub in WinBox's table (`src/win16/commdlg/index.ts`, named `Unknown`, popping 10 bytes, as the entry's `retf` does), and the Rust engine has no arm for it (`crates/winbox-win16/src/commdlg/mod.rs`). With `COMMDLG.DLL` on the drive the file's own code runs it for the file's own callers, whose calls between their functions stay the file's. Without the file, WinBox registers the six messages as `COMMDLG` loads, in the same order ([[topic:common-dialogs]]); it does not make the memory device context.
