---
kind: function
module: COMMDLG
name: FindText
ordinal: 11
summary: Opens the modeless Find dialog for a program's own window, which tells that window of each search asked for with FINDMSGSTRING's message — read out of COMMDLG.DLL and recorded.
versions:
  '3.1': exact
probes: [findrepl]
topics: [common-dialogs]
source: src/win16/commdlg/find-replace.ts
---

## Observed behaviour

[[probe:findrepl]] makes a window of its own, opens the dialog for it with a hook, and passes its messages through [[fn:USER.IsDialogMessage]]. The keys go in through USER's `KEYBD_EVENT`, as a person presses them. It records what the owner is told, what the hook is given, each control's state and the dialog's pixels.

- [[measured]] It answers the dialog's window, shown and active, and leaves it open: the program's own loop runs it. Each search is a `SendMessage` to the owner of the message `RegisterWindowMessage("commdlg_FindReplace")` registers, `wParam` nought and `lParam` the program's own `FINDREPLACE`, with its `Flags` and text as the dialog leaves them ([[topic:common-dialogs]]).
- [[measured]] What fails answers nought and sets [[fn:COMMDLG.CommDlgExtendedError]]:

| Asked                                                    | Error                           |
| -------------------------------------------------------- | ------------------------------- |
| `lStructSize` not 36                                     | 1, `CDERR_STRUCTSIZE`           |
| A null `FINDREPLACE`                                     | none: the last error stands     |
| An owner that is not a window                            | 4001h, `FRERR_BUFFERLENGTHZERO` |
| No `lpstrFindWhat`, or a `wFindWhatLen` of nought        | 4001h                           |
| `FR_ENABLEHOOK` and no hook                              | 0Bh, `CDERR_NOHOOK`             |
| `FR_ENABLETEMPLATE` with a name the instance has not got | 6, `CDERR_FINDRESFAILURE`       |
| `FR_ENABLETEMPLATEHANDLE` with a handle of nought        | 8, `CDERR_LOCKRESFAILURE`       |

- [[measured]] A successful call sets the error to nought, and a hook not asked for is written over with nought in the program's structure.

## Nuances

- [[read out]] An owner that is no window is reported as a buffer of no length: the call tests the owner, the text and its length together (`COMMDLG.DLL` seg5 `0038`).
- [[read out]] The template is the program's resource of type 5 by the name in `lpTemplateName`, or with `FR_ENABLETEMPLATEHANDLE` the global handle in `hInstance`, else COMMDLG's own dialog 1540. Each is locked, the dialog made with `CreateDialogIndirectParam` on COMMDLG's instance, and unlocked again — never freed.
- [[read out]] The dialog's procedure is COMMDLG's export `FindTextDlgProc`, ordinal 13. It gives the hook nothing until it has its property, in `WM_INITDIALOG`, so the `WM_SETFONT` and `WM_PARENTNOTIFY` USER sends as it makes the dialog reach no hook ([[topic:common-dialogs]]). [[measured]] The hook was given three `WM_COMMAND`s and a `WM_CTLCOLOR` of the dialog's own setting up, then its `WM_INITDIALOG`, whose `lParam` is the structure.

## Inside Windows

[[read out]] `FindText` is `COMMDLG.DLL` seg5 `0000`, and its dialog's procedure seg5 `036d`; [[topic:common-dialogs]] has both, step by step.

## Implementation

WinBox's own: `FindText` in `src/win16/commdlg/find-replace.ts` and `crates/winbox-win16/src/commdlg/find_replace.rs`, with COMMDLG's dialog 1540 kept as bytes of WinBox's own. It works with no `COMMDLG.DLL` on the drive.
