---
kind: function
module: COMMDLG
name: GetSaveFileName
ordinal: 2
summary: COMMDLG's Save As box — the Open box under another caption, with Save As's checks of the name chosen — WinBox's own, its template and its code, with or without COMMDLG.DLL.
versions:
  '3.1': partial
probes: [ofnerr]
source: src/win16/commdlg/file-dialogs.ts
topics: [common-dialogs, file-dialogs]
---

## Observed behaviour

`GetSaveFileName` is [[fn:COMMDLG.GetOpenFileName]] with another procedure. Everything that page says of the start, the template, the hook, the lists and the answer holds for it.

- [[measured]] A structure of the wrong size is refused with `CDERR_STRUCTSIZE` as Open's is: [[probe:ofnerr]] gives Save As a size of 73.
- Not yet measured: the box itself, and Save As's checks of the name.

## Nuances

- [[read out]] One far pointer to the `OPENFILENAME`, 4 bytes popped, a `BOOL` answered, as Open (`COMMDLG.DLL` seg2 `0c48`).
- [[read out]] Save As's caption and type label are COMMDLG's strings, set only on COMMDLG's own template ([[fn:COMMDLG.FileSaveDlgProc]]).

## Inside Windows

[[read out]] Both functions run the one start (seg2 `09eb`), Save As with [[fn:COMMDLG.FileSaveDlgProc]] (entry 7, seg2 `446a`) in place of [[fn:COMMDLG.FileOpenDlgProc]] (entry 6, seg2 `42a3`). What Save As does otherwise:

- As the box is made, unless the program gave its own template, its caption is set to `Save As` and the types' label to `Save File as &Type:` (seg2 `4523`, strings 181h and 182h).
- OK finds a file that is there (seg2 `2af0`): Save As then sees that a file can be made in its folder, with a temporary file made and deleted by DOS 5Ah (seg2 `224f`, [[fn:COMMDLG.Ordinal 47]]); a drive's root is let be. With `OFN_OVERWRITEPROMPT` it asks "`<path>` This file already exists. Replace existing file?" (string 101h, seg2 `4d23`), Yes or No with No preferred. No puts the focus back on the name and keeps the box.
- A file that is not there (seg2 `2c1f`): Open refuses it with `OFN_FILEMUSTEXIST`, and asks "This file does not exist. Create the file?" (string 192h) where `OFN_CREATEPROMPT` is set too. Save As takes it.
- A name taken that is not there, for either: with `OFN_PATHMUSTEXIST`, and without `OFN_NOTESTFILECREATE`, the file is made, closed and deleted again, to see that it can be (seg2 `2d56`).

## Implementation

The same code as Open's in both engines, `save` set: `src/win16/commdlg/file-dialogs.ts`, `file-init.ts`, `file-command.ts`, `file-ok.ts` and `file-lists.ts`, and the same-named files under `crates/winbox-win16/src/commdlg/`. Write's and Paintbrush's Save As run on it in the accessories' sessions.

## Not yet done

- Save As's checks — the overwrite prompt, the file made and deleted, a folder no file can be made in — are read out and followed, but not yet recorded by a probe of their own.
- What the hook is sent of `SHAREVISTRING` for a file another program has open is followed but not recorded.
