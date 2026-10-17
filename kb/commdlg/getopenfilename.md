---
kind: function
module: COMMDLG
name: GetOpenFileName
ordinal: 1
summary: COMMDLG's Open box — the name, the files, the folders, the types and the drives, a program's hook and template within it — WinBox's own, its template and its code, with or without COMMDLG.DLL.
versions:
  '3.1': partial
probes: [ofnopen, ofnerr]
source: src/win16/commdlg/file-dialogs.ts
topics: [common-dialogs, file-dialogs]
---

## Observed behaviour

[[probe:ofnopen]] opens the box with a hook in a folder of its own, `C:\ORACLE\OFN`, holding `A.TXT`, `B.TXT`, `README`, `C.DOC`, `D.TX` and the folders `SUB` and `ANOTHER`. Its filter is `Text (*.txt)`, `Documents` (`*.doc`) and `All Files`, chosen 2, with a custom filter `Mine` (`*.tx`). It records the controls, what the hook is sent, and the box's state after each of sixteen steps a timer takes. [[probe:ofnerr]] records what the call refuses and the flags it leaves. Both engines agree with all of both probes' records.

**The box** ([[measured]]):

- The controls, in order, with their places in the client area: `File &Name:` (442h), the name's edit (480h), the files' list (460h), `&Directories:` (FFFFh), the folder's name (440h), the folders' list (461h), `List Files of &Type:` (441h), the types' combo box (470h), `Dri&ves:` (443h), the drives' combo box (471h), OK, Cancel, `&Help` (40Eh) and `&Read Only` (410h). The probe's flags, 1830h, ask for both Help and Read Only.
- The hook is sent, before `WM_INITDIALOG`, `WM_SETFONT`, `WM_GETFONT` and the owner-drawn lists' `WM_MEASUREITEM`, then the commands the name's edit and the combo boxes send as they are filled, and `LBSELCHSTRING` for the type chosen and for the drive. `WM_INITDIALOG` comes with the name's edit as `wParam` and the structure as `lParam`.
- The name's edit holds the chosen type's pattern, `*.doc`, lowered. The folder's name is lowered, `c:\oracle\ofn`. The files' list holds the files the pattern matches, in capitals, with rows 13 high and nothing selected. The folders' list holds `C:\`, each folder down to the current one, and the current one's folders, rows 16 high, the current one selected.
- The types' list starts with the custom filter's description, then the filter's descriptions; each item's data is its pattern's offset. The drives' list holds each drive as `a:`, and `c: c_drive` with its volume label lowered, its data the drive's kind, rows 16 high, the current drive chosen.

**The steps** ([[measured]]):

- A pattern typed and OK (`*.doc`): the files' list is filled again for it. A folder typed (`sub`, `..`): the box goes into it, and the name's edit keeps the pattern.
- A file that is not there: a box with the dialog's caption, OK alone, "`nosuch.txt` Cannot find this file. Please verify that the correct path and filename are given." A name the parser refuses, `c:\oracle\ofn\sub\e.txt;x`: "This filename is not valid." The name stays in the edit for the user to change.
- A type chosen: the files' list is filled for its pattern. The name in the edit is kept where it is not a pattern.
- A file chosen in the files' list: its name, lowered, goes into the edit, and the hook is sent `LBSELCHSTRING`.
- The current folder double-clicked: nothing changes but the files' list's selection. A folder above it double-clicked: the box goes there.
- `a:` chosen with no disk in it: "Cannot read drive a:. Please verify the drive door is closed and that the disk is formatted and free of errors.", Retry and Cancel. Cancel puts the drives' list back on the drive that was current, with `LBSELCHSTRING`.
- A file named and OK: the hook is sent `FILEOKSTRING` with the structure, and answering nought ends the box. The call answers 1, the error nought. The structure holds the path `OpenFile` made of the name, in capitals (`C:\ORACLE\OFN\A.TXT`), the title, the offsets of the title (14) and of its extension (16), the filter's index as last chosen (1), and the custom filter with the pattern last typed (`Mine`, `*.TXT`).
- The current directory is left where the box last was, `C:\ORACLE`.

**What it refuses** ([[measured]], [[probe:ofnerr]]): a structure of a size other than 72, a template asked for and not found, and a hook asked for and not given, each answered nought with its error at once ([[fn:COMMDLG.CommDlgExtendedError]]).

- A file name given as the box starts is lowered in the program's buffer and parsed. One the parser refuses (`IN SIDE`, `C:\D*R\X`, `FILE.TEXT`, `1:\X`) ends the call at once with `FNERR_INVALIDFILENAME`, 3002h. `A;B`, `*.TXT;*.DOC`, spaces alone and `X.TXT` start the box. With `OFN_NOVALIDATE` the name is neither lowered nor parsed.
- The flags after a call: `OFN_FILEMUSTEXIST` adds `OFN_PATHMUSTEXIST`; `OFN_CREATEPROMPT` adds both. 70000000h, COMMDLG's own bits, is cleared; 80000000h is kept.
- Without `OFN_ENABLEHOOK`, a hook's pointer given is cleared in the structure.

## Nuances

- [[read out]] One far pointer to the `OPENFILENAME`, 4 bytes popped; the answer is a `BOOL`, 1 only where the box ended with 1 ([[topic:file-dialogs]] has the structure).
- [[read out]] The size is checked before the hourglass is shown, so a refused size leaves the cursor alone; everything after it runs with the hourglass ([[fn:COMMDLG.Ordinal 32]]).
- [[read out]] A template that cannot be locked answers nought with no error set: `LockResource` failing is not given a code (seg2 `0a2a` onwards).
- [[read out]] The hook is called before `WM_INITDIALOG` through COMMDLG's data, where [[fn:COMMDLG.FindText]] and [[fn:COMMDLG.ChooseColor]] call theirs only once the dialog has its property ([[topic:common-dialogs]]).

## Inside Windows

[[read out]] `COMMDLG.DLL` seg2:

1. **The start** (`09eb`): the structure's size checked (`09fc`), the hourglass shown and the error cleared (`0a2a`). The template is the program's handle with `OFN_ENABLETEMPLATEHANDLE`, its named dialog with `OFN_ENABLETEMPLATE`, else COMMDLG's own 1536, or 1537 for `OFN_ALLOWMULTISELECT`. `SetErrorMode(8003h)` while the box is up. The hook is kept for what comes before `WM_INITDIALOG`. Then `DialogBoxIndirectParam` with COMMDLG's instance and `FileOpenDlgProc` (entry 6, `42a3`); `-1` is `CDERR_DIALOGFAILURE`. The answer is 1 where the box ended with 1.
2. **The procedure**, [[fn:COMMDLG.FileOpenDlgProc]] (`42a3`): the program's hook first; what it answers is not COMMDLG's to answer. The pictures are made again for `WM_SYSCOLORCHANGE` (`43ee`).
3. **`WM_INITDIALOG`** (`1153`): a block of 40Dh bytes for the box; the name lowered and parsed (`1220`); the custom filter (`1587`) and the filter's types (`1646`, `469c`); the drives, the current one chosen, and the lists filled (`1818`); the folders' list and OK subclassed (`18ad`, `10a5`, `100f`); the hook sent `WM_INITDIALOG`.
4. **The lists** (`039b`, `0180`): the files by DOS searches, one for each pattern between `;`s, the folders as a path down to the current one. The drives (`4827`), with their volume labels, from DOS.
5. **OK** (`22e7`): the name parsed; a folder or a path before the name gone into (`25fc`); a wildcard made the files' pattern (`2860`); the default extension added where there is none (`29d7`); the file looked for with `OpenFile` and the flags' checks made ([[fn:COMMDLG.GetSaveFileName]]); `FILEOKSTRING` sent to the hook; the structure written (`2e90`).
6. **The rows** (`4dcc`, `4e8a`): the folders' and drives' lists are owner-drawn, a picture from bitmap 576 beside each name ([[fn:COMMDLG.Ordinal 42]]).

## Implementation

In both engines, a function at a time as the file runs it, each call into KERNEL, USER and GDI made as the file makes it ([[topic:file-dialogs]]):

- `src/win16/commdlg/file-dialogs.ts` (the start), `file-init.ts` (the procedure, `WM_INITDIALOG`, the subclasses), `file-command.ts` (the controls), `file-ok.ts` (OK), `file-lists.ts` (the lists, the drives, the boxes, the rows), `pictures.ts`; the templates and strings in `file-open-dialog.ts`, `multi-file-open-dialog.ts` and `strings.ts`.
- `crates/winbox-win16/src/commdlg/file_dialogs.rs`, `file_init.rs`, `file_command.rs`, `file_ok.rs`, `file_lists.rs`, `pictures.rs`, `resources.rs`.

The templates are WinBox's own, built in. Without `COMMDLG.DLL` on the drive the box is the same, but for the folders' and drives' pictures, which are the file's bitmap and are not drawn; their rows keep their size. Notepad's Open is used both ways in `test/win16/file_dialogs_test.ts` and `crates/winbox-web/tests/file_dialogs.rs`. Media Player's Open (a hook) and Control Panel's Add Fonts (a hook and a template) run on it too.

## Not yet done

- `OFN_ALLOWMULTISELECT` is followed but not recorded.
- The hook's `SHAREVISTRING` and `HELPMSGSTRING`, a network drive's names, and a CD-ROM drive's picture are not recorded.
- The box's block is kept by the engines by its window, not by `SetProp` A000h as the file keeps it: a program that reads the property finds nothing.
- The box's screen is not recorded: DOSBox's screenshot of it came out black.
