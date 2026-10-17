---
kind: function
module: COMMDLG
name: FileSaveDlgProc
ordinal: 7
summary: The Save As box's procedure, which GetSaveFileName hands to USER — FileOpenDlgProc's work under Save As's caption and type label, with Save's checks of the name chosen.
versions:
  '3.1': partial
probes: [ofnerr]
topics: [common-dialogs, file-dialogs]
source: src/win16/commdlg/file-init.ts
---

## Observed behaviour

No program calls it. [[fn:COMMDLG.GetSaveFileName]] gives its far address to `DialogBoxIndirectParam` with the `OPENFILENAME` as the parameter (`COMMDLG.DLL` seg2 `0c5e`); USER calls it as the box's procedure.

- [[read out]] It is [[fn:COMMDLG.FileOpenDlgProc]] message for message: the hook first, through the property A000h or, before `WM_INITDIALOG`, the hook kept in COMMDLG's data; the same `WM_ACTIVATE`, `WM_SYSCOLORCHANGE`, `WM_MEASUREITEM` and `WM_DRAWITEM` (seg2 `446a`).
- [[read out]] In `WM_INITDIALOG`, before the box is set up, and unless the program gave a template of its own (`OFN_ENABLETEMPLATE` or `OFN_ENABLETEMPLATEHANDLE`), the box's caption is set to COMMDLG's string 181h, "Save As", and the types' label, 441h, to string 182h, "Save File as &Type:" (seg2 `4523`).
- [[read out]] `WM_COMMAND` goes to the controls' code with Save's flag set (seg2 `45ee`), which makes OK run Save As's checks: a file that is there may be replaced, a folder must take a new file ([[topic:file-dialogs]]).
- [[measured]] [[probe:ofnerr]] gives Save As a structure of the wrong size, refused before the box is made. Not yet measured: the box itself, and Save As's checks.

## Nuances

- [[read out]] A program's template keeps its own caption and label: the strings are set only for COMMDLG's.

## Inside Windows

[[read out]] `COMMDLG.DLL` seg2 `446a`, `retf 0Ah`.

## Implementation

WinBox's own: `FileSaveDlgProc` in `src/win16/commdlg/file-init.ts` and `file_save_dlg_proc` in `crates/winbox-win16/src/commdlg/file_init.rs`, the Open box's code with `save` set. Write's and Paintbrush's Save As run on it in the accessories' sessions.

## Not yet done

- No probe records the Save As box, its caption or its checks.
