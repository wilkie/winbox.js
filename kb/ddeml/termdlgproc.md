---
kind: function
module: DDEML
name: TERMDLGPROC
ordinal: 39
summary: The dialog procedure of DDEML's TermDialog, which DdeUninitialize shows when a partner does not answer its WM_DDE_TERMINATE in time.
probes: [ddeterm]
topics: [dynamic-data-exchange]
---

## Observed behaviour

- [[measured]] [[probe:ddeterm]]: the dialog, as `DdeUninitialize` showed it, was "Windows DDE", class `#32770`, owned by nothing and active, style 94C800C2h -- `DS_SYSMODAL` among it -- at 152,31 to 479,283 on the VGA. Its controls, in order: statics 101 to 104 with its four sentences, buttons Retry (4, `BS_DEFPUSHBUTTON`), Continue (5) and Close (3), and statics 108 to 110, each `*`.
- [[measured]] A `WM_COMMAND` of `IDCANCEL` left it up. Retry, Continue and Close each ended it, and `DdeUninitialize` did with each what [[fn:DDEML.DdeUninitialize]] says.

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `036a`: `WM_INITDIALOG` answers TRUE; `WM_COMMAND` 3, 4 or 5 ends the dialog with that number. The template, `TermDialog` in DDEML's resources, is "Windows DDE": "An application using DDE did not respond to the system's exit command", with Retry (4, the default), Continue (5) and Close. [[fn:DDEML.DdeUninitialize]] stops waiting on Close (3) or a dialog that failed, waits `ShutdownRetryTimeout` more on Retry, and waits on with no timer on Continue (`04d0`-`04f8`).

## Implementation

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation; this is its own, internal to it.
