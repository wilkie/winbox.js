---
kind: function
module: COMMDLG
name: FormatCharDlgProc
ordinal: 16
summary: The Font dialog's procedure — the program's hook first, then the lists, their owner-drawn rows, the sample, the controls, OK and WM_CHOOSEFONT_GETLOGFONT — which ChooseFont hands to USER's DialogBoxIndirectParam.
versions:
  '3.1': exact
probes: [chfont, chfont2]
topics: [common-dialogs, choose-font]
source: src/win16/commdlg/choose-font.ts
---

## Observed behaviour

No program calls it. [[fn:COMMDLG.ChooseFont]] gives its far address to `DialogBoxIndirectParam` with the `CHOOSEFONT` as the parameter, and USER calls it as the dialog's procedure, with the dialog, a message, `wParam` and `lParam`; it answers a `BOOL` as a dialog procedure does.

- [[read out]] Once the dialog has its property A000h, and the structure has `CF_ENABLEHOOK`, every message goes first to the hook at `lpfnHook`; an answer not nought is the procedure's answer (`COMMDLG.DLL` seg4 `02f0`). Before the property, the hook `ChooseFont` kept in COMMDLG's data has every message but `WM_INITDIALOG` (`0317`).
- [[read out]] What it handles (`0344`):

| Message                    | Where          | What                                                                                                   |
| -------------------------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| `WM_INITDIALOG`            | `037a`         | the dialog set up, the lists filled; the hook's answer, or the arrow set and 1                         |
| `WM_PAINT`                 | `0754`, `226b` | the sample drawn in the font chosen                                                                    |
| `WM_SYSCOLORCHANGE`        | `0839`         | the faces' pictures made again from bitmap 38                                                          |
| `WM_MEASUREITEM`           | `0787`         | an item the dialog font's height, at least 12; the edit field that height and one                      |
| `WM_DRAWITEM`              | `0805`         | a face with its picture (`1f44`), a colour with its swatch (`20c4`), a size (`1e67`)                   |
| `WM_COMMAND`               | `084e`, `0b9d` | the lists' notifications, the check boxes, OK, Cancel, Help; Apply left to the hook                    |
| `WM_CHOOSEFONT_GETLOGFONT` | `0865`, `241e` | the `LOGFONT` written to `lParam` as OK writes it; answers whether face, style and size are all chosen |

- [[read out]] Anything else answers nought, as does a `WM_COMMAND` from a control it does not know -- Apply's among them (`0be7`); what it handles answers 1, but where the table says otherwise.
- [[measured]] [[probe:chfont]] records the controls, the lists, the hook's messages, Help's message to the owner, the boxes it puts up, and `WM_CHOOSEFONT_GETLOGFONT`, with seven sets of flags: as read out, on both engines.
- [[measured]] [[probe:chfont2]] records the sample's pixels and the colours' box, a face and a style typed whole, a hook answering OK itself -- the dialog stayed, the hook's answer the procedure's -- a program's template, and "Size must be a number.": as read out, on both engines. [[probe:chfont3]] records the lists' rows: the pictures of bitmap 38 agree, the text not yet ([[topic:choose-font]]).

## Nuances

- [[read out]] `WM_INITDIALOG` fails, ending the dialog with nought and setting the extended error, for a style name not loaded (`CDERR_LOADSTRFAILURE`), a size limit upside down (`CFERR_MAXLESSTHANMIN`), its memory (`CDERR_MEMALLOCFAILURE`) and no faces (`CFERR_NOFONTS`).
- [[read out]] Choosing a style writes its weight and italic into the program's `LOGFONT` at once, not at OK (`0fe6`); and `WM_CHOOSEFONT_GETLOGFONT` changes the program's `CF_NOFACESEL`, `CF_NOSTYLESEL` and `CF_NOSIZESEL`.
- [[measured]] `SendMessage` of `WM_CHOOSEFONT_GETLOGFONT` answered 1 each of the three times, each with something not chosen, where the procedure answers nought. [[inferred]] Its number, 401h, is also the dialog manager's `DM_SETDEFID`, which a procedure's nought hands on to `DefDlgProc`.
- [[read out]] The procedure does not show the dialog: its template is not `WS_VISIBLE`, and `DialogBoxIndirectParam` shows it.
- Each step is in [[topic:choose-font]].

## Inside Windows

[[read out]] `COMMDLG.DLL` seg4 `02b0`, `retf 0Ah`; [[fn:COMMDLG.ChooseFont]] takes its address at seg4 `0110`.

## Implementation

WinBox's own: `FormatCharDlgProc` in `src/win16/commdlg/choose-font.ts` and `format_char_dlg_proc` in `crates/winbox-win16/src/commdlg/choose_font.rs`, given to USER at its stub's address. The dialog's structure is kept in WinBox's memory by the number under its property A000h, where COMMDLG keeps four bytes of its local memory. It works with no `COMMDLG.DLL` on the drive.
