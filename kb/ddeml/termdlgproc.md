---
kind: function
module: DDEML
name: TERMDLGPROC
ordinal: 39
summary: The dialog procedure of DDEML's TermDialog, which DdeUninitialize shows when a partner does not answer its WM_DDE_TERMINATE in time.
topics: [dynamic-data-exchange]
---

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `036a`: `WM_INITDIALOG` answers TRUE; `WM_COMMAND` 3, 4 or 5 ends the dialog with that number. The template, `TermDialog` in DDEML's resources, is "Windows DDE": "An application using DDE did not respond to the system's exit command", with Retry (4, the default), Continue (5) and Close. [[fn:DDEML.DdeUninitialize]] stops waiting on Close (3) or a dialog that failed, waits `ShutdownRetryTimeout` more on Retry, and waits on with no timer on Continue (`04d0`-`04f8`).

Not yet recorded.

## Implementation

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation; this is its own, internal to it.
