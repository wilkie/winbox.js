---
kind: function
module: DDEML
name: TERMDLGPROC
ordinal: 39
summary: The dialog procedure of DDEML's TermDialog, which DdeUninitialize shows when a partner does not answer its WM_DDE_TERMINATE in time.
versions:
  '3.1': unrecorded
source: src/win16/ddeml/instance.ts
topics: [dynamic-data-exchange]
---

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `036a`: `WM_INITDIALOG` answers TRUE; `WM_COMMAND` 3, 4 or 5 ends the dialog with that number. The template, `TermDialog` in DDEML's resources, is "Windows DDE": "An application using DDE did not respond to the system's exit command", with Retry (4, the default), Continue (5) and Close. [[fn:DDEML.DdeUninitialize]] stops waiting on Close (3) or a dialog that failed, waits `ShutdownRetryTimeout` more on Retry, and waits on with no timer on Continue (`04d0`-`04f8`).

Not yet recorded.

## Implementation

WinBox's own: `termDlgProc` in `src/win16/ddeml/instance.ts` and `term_dlg_proc` in `crates/winbox-win16/src/ddeml/instance.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. It is WinBox's own export, the procedure `DialogBoxIndirect` is given with DDEML's `TermDialog` template, kept as WinBox's own data (`resources.ts`, `resources.rs`). Not yet recorded.
