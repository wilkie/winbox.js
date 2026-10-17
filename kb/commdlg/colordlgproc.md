---
kind: function
module: COMMDLG
name: ColorDlgProc
ordinal: 8
summary: The Color dialog's procedure — the program's hook first, then the grids, the spectrum, the luminosity bar, the numbers and the buttons — which ChooseColor hands to USER's DialogBoxIndirectParam.
versions:
  '3.1': exact
probes: [choosclr]
topics: [common-dialogs, choose-color]
source: src/win16/commdlg/choose-color.ts
---

## Observed behaviour

No program calls it. [[fn:COMMDLG.ChooseColor]] gives its far address to `DialogBoxIndirectParam` with the `CHOOSECOLOR` as the parameter, and USER calls it as the dialog's procedure, with the dialog, a message, `wParam` and `lParam`; it answers a `BOOL` as a dialog procedure does.

- [[read out]] Once the dialog has its property A000h, and the program's structure has `CC_ENABLEHOOK`, every message goes first to the hook at the structure's `lpfnHook`; an answer not nought is the procedure's answer and nothing else is done (`COMMDLG.DLL` seg1 `01ab`). Before the property, in what USER sends as it makes the dialog, no hook is called.
- [[read out]] What it handles (seg1 `01ea`):

| Message                 | Where           | What                                                                                      |
| ----------------------- | --------------- | ----------------------------------------------------------------------------------------- |
| `WM_INITDIALOG`         | `0274`, `17c5`  | with the wait cursor ([[fn:COMMDLG.Ordinal 32]]) the dialog set up; not nought, shown     |
| `WM_MOVE`               | `02af`, `1654`  | the spectrum's, bar's and sample's rectangles measured again from their controls          |
| `WM_PAINT`              | `0e0c`          | the grids, the spectrum, the bar, its mark and the sample                                 |
| `WM_GETDLGCODE`         | `0816`          | answers 0Dh                                                                               |
| `WM_KEYDOWN`, `WM_CHAR` | `07f5`, `0751`  | the focus box moved, Home and End, Space choosing, sent here by [[fn:COMMDLG.WantArrows]] |
| `WM_COMMAND`            | `081c`          | the buttons and the six numbers' `EN_CHANGE` and `EN_KILLFOCUS`                           |
| the mouse's             | `02dd` – `069a` | a press, a move, a release; a double click on the sample's solid half (`02ba`)            |
| `SETRGBSTRING`'s        | `0239`          | a box of the colour in `lParam` chosen, or, opened out, the colour taken                  |

- [[read out]] Anything else answers nought.
- [[measured]] [[probe:choosclr]] drives the dialog with the keys and the mouse and records what the hook is given, the controls, the numbers and the pixels: every record is as read out, and both engines agree with all of them.

## Nuances

- [[read out]] The dialog is shown by the procedure: `ShowWindow(SW_SHOWNORMAL)` after `WM_INITDIALOG` answers not nought (seg1 `02a4`). Its template is not `WS_VISIBLE`.
- [[read out]] Unlike the file dialogs' procedures, it keeps no hook in COMMDLG's data for the messages before the property: the hook sees nothing before `WM_INITDIALOG` ([[topic:common-dialogs]]).
- Each step, with its arithmetic, is in [[topic:choose-color]].

## Inside Windows

[[read out]] `COMMDLG.DLL` seg1 `0197`, `retf 0Ah`; [[fn:COMMDLG.ChooseColor]] takes its address at seg1 `0fe0`.

## Implementation

WinBox's own: `ColorDlgProc` in `src/win16/commdlg/choose-color.ts` and `color_dlg_proc` in `crates/winbox-win16/src/commdlg/choose_color.rs`, given to USER at its stub's address. It works with no `COMMDLG.DLL` on the drive.
