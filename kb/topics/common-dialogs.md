---
kind: topic
name: Common dialogs
summary: COMMDLG, Windows 3.1's common dialogs, made WinBox's own a function at a time — how a call reaches WinBox's code or the file's, its extended error, its registered messages, and its file dialogs — read out of COMMDLG.DLL.
probes: [loadpath, ofnopen, ofnerr, ftitle]
---

`COMMDLG.DLL` holds Windows 3.1's common dialogs: Open and Save As, Find and Replace, Color, Font and Print. Programs import it by name, or load it with [[fn:KERNEL.LoadLibrary]], as WinHelp does. WinBox makes it its own a function at a time. A function not yet made its own stays the file's code while the drive has `COMMDLG.DLL` ([[topic:dynamic-link-libraries]]).

## One COMMDLG, two codes

- With the file, the program gets the file's library: its module handle and instance, its count, and its entry point. An import of an export WinBox answers is linked to WinBox's stub for that ordinal instead of the file's entry, and [[fn:KERNEL.GetProcAddress]] answers the stub.
- Without the file, every import is WinBox's stub. An export WinBox does not answer yet answers nought, as a stub does. [[fn:KERNEL.LoadLibrary]] finds `COMMDLG.DLL` by its name whether or not the file is there.
- A dialog WinBox makes is made with `COMMDLG`'s instance, and its procedure is WinBox's stub for the export the file would have used, called by USER as any procedure is.
- [[read out]] `COMMDLG` calls a program's hook with its own data segment in DS (`COMMDLG.DLL` seg2 `42f4`, seg2 `4331`). WinBox calls one so, with the file's data segment or its own.
- [[read out]] While it works, `COMMDLG` sets the hourglass, and the arrow when it is done (entry 32, seg2 `08e2`). It sets neither while its Open or Save dialog is being made (`[0CACh]`, seg2 `4354`). Where no mouse was present as it loaded, it also shows and hides the cursor. WinBox always has a mouse.

## The extended error

- [[read out]] `CommDlgExtendedError` answers a doubleword `COMMDLG` keeps, `[2CCh]` in its data (seg6 `01f1`), and changes nothing. Each function sets it as it fails; `GetOpenFileName` and `GetSaveFileName` clear it as they start (seg2 `0a2a`).
- WinBox keeps the one doubleword: the file's while the file is loaded, found from the file's own `CommDlgExtendedError`, and its own otherwise. The error reads the same whichever code failed last.

## Registered messages

- [[read out]] The entry point registers, in this order, `commdlg_LBSelChangedNotify` (`LBSELCHSTRING`), `commdlg_ShareViolation` (`SHAREVISTRING`), `commdlg_FileNameOK` (`FILEOKSTRING`), `commdlg_ColorOK` (`COLOROKSTRING`) and `commdlg_SetRGBColor` (`SETRGBSTRING`) (seg7 `010b` to `014c`). Once it has made its memory device context it registers `commdlg_help` (`HELPMSGSTRING`) (seg7 `0208`). `FindText` and `ReplaceText` register `commdlg_FindReplace` (`FINDMSGSTRING`) each time they are called.
- Without the file, WinBox registers the six as `COMMDLG` loads, in the same order. A message registered again keeps its number, so a program that registers one by its name gets the number `COMMDLG` uses.

## The file dialogs

[[fn:COMMDLG.GetOpenFileName]] and [[fn:COMMDLG.GetSaveFileName]] are WinBox's own, with [[fn:COMMDLG.GetFileTitle]] and [[fn:COMMDLG.CommDlgExtendedError]]. [[probe:ofnopen]], [[probe:ofnerr]] and [[probe:ftitle]] record them, and both engines agree with all their records.

- **The templates are WinBox's own**: Open and Save As's box, 1536, and the box for several files, 1537, built into the engines with COMMDLG's strings. A program's template, named or by handle, is used in their place as COMMDLG uses one.
- **The procedures** are WinBox's stubs for entries 6 and 7, `FileOpenDlgProc` and `FileSaveDlgProc`, and the subclasses of the folders' list and OK are entries 29 and 31, `dwLBSubclass` and `dwOKSubclass`. A program that asks [[fn:KERNEL.GetProcAddress]] for them gets those.
- **The hook** is called before COMMDLG's own code for every message, as the file calls it, and is sent what comes before `WM_INITDIALOG` too.
- **Each call into KERNEL, USER and GDI** is made as the file makes it: its arguments pushed below the stack, its strings and structures laid out below them, and the function that answers a program's call run (`api.ts`, `api.rs`). So the lists are filled, the boxes put up and the rows drawn by USER as they would be for the file, and USER's own quirks show in WinBox's dialogs as in COMMDLG's.
- **The folders' and drives' pictures** are bitmap 576 of the installation's `COMMDLG.DLL`, read as data. With no file there are none; the rows keep their height.
- **Without `COMMDLG.DLL`** on the drive, Notepad's Open does all it does with the file: `test/win16/file_dialogs_test.ts` and `crates/winbox-web/tests/file_dialogs.rs`.

Fixing USER and DOS for the probes: a dialog's controls are made with `WS_EX_NOPARENTNOTIFY` ([[topic:dialog-boxes]]); a combo box lays itself out again for `WM_SETFONT`, and has `CBS_HASSTRINGS` in its style ([[topic:combo-boxes]]); a list box or combo box draws as it changes only where it and every window above it are visible; DOS's function 47h fails on a drive with no disk ([[topic:drives-and-disks]]).

## WinBox's code

The registration point is one entry per export, in each engine:

- TypeScript: `src/win16/commdlg/index.ts`, the export table. An export WinBox answers has its function in place of `CommDlg.stub`, with the bytes it pops, its arguments' types and its answer's type.
- Rust: `crates/winbox-win16/src/commdlg/mod.rs`, `implementation`, one arm per export by its name.
- `kept.rs` is written again from the TypeScript table (`npm run rust:modules`). The Rust test `commdlg::tests::ours_agree` checks that the two engines answer the same exports.

Helpers both engines keep for the dialogs: the far address of an export WinBox answers (`procAddress`, `proc_address`), the extended error (`setError`, `set_error`), `COMMDLG`'s instance (`instance`), a hook called as `COMMDLG` calls one (`callHook`, `call_hook`), the wait cursor (`waitCursor`, `wait_cursor`) and the registered messages (`message`).

## Not yet done

- `FindText`, `ReplaceText`, `ChooseColor`, `ChooseFont` and `PrintDlg` are still the file's code, or stubs without the file.
- The memory device context the entry point makes and keeps (seg7 `01a1` to `0203`) is not made without the file.
- A file box's block is kept by its window, not by `SetProp` A000h as the file keeps it.
- Save As's checks, `OFN_ALLOWMULTISELECT`, `SHAREVISTRING`, network drives and CD-ROM drives are read out and followed but not recorded.
