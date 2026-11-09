---
kind: function
module: OLECLI
name: CONNECTDLGPROC
ordinal: 950
summary: 'The procedure of the dialog "Connect Network Drive", which connects a free drive to a link''s share.'
versions:
  '3.1': partial
probes: [olenet]
source: crates/winbox-win16/src/olecli/mod.rs
topics: [ole]
---

## Observed behaviour

- [[measured]] [[probe:olenet]]: shown by [[fn:OLECLI.CHECKNETDRIVE]], "Connect Network Drive", the system font's, owned by the task's visible window: "D&rive:" and a list of the drives not there, D: to Y: on DOSBox, the first chosen; "&Network Path:" and the share; "Pass&word:" and a password's field; "&Connect" and "C&ancel". Each control's class, number, text, style and place written; cancelled, the dialog answers nought.

## Nuances

- `unrecorded`: Connect -- the drive chosen connected to the share by `WNetAddConnection` with the password, the dialog ended with the drive's letter; a connection that fails told in a box, `Network Error`, Retry or Cancel.
- WinBox's dialog is laid out from what [[probe:olenet]] measured, at two pixels to a dialog unit each way, with no byte of `OLECLI.DLL`'s resource.

## Inside Windows

- [[read out]] `OLECLI.DLL` seg8: `0456`: `WM_INITDIALOG` keeps the share's name, given as the dialog's parameter, in two of its properties, lists the drives `GetDriveType` calls not there (seg8 `0624`), shows the share, and answers FALSE; `IDOK` reads the drive and password and calls `WNetAddConnection`, ending the dialog with the drive's letter, or shows `WNetGetErrorText`'s text (else its string 601) under its string 600 in a box of Retry and Cancel, Cancel ending the dialog; `IDCANCEL` ends it with nought; the share's field losing the focus is given the share again. WinBox keeps the share's name in its own state rather than the dialog's properties.

## Implementation

WinBox's own: `src/win16/olecli/network.ts` and its twin in `crates/winbox-win16/src/olecli/network.rs`, written from the interface, the probes and, where no probe can say, a read-out described in prose -- not from the code of `OLECLI.DLL` ([[topic:ole]]). Both engines agree with [[probe:olehnd]], [[probe:olenet]], [[probe:oleemb]] and the other probes of [[topic:ole]], with `OLECLI.DLL` on the drive and without it (`test/win16/olecli_test.ts`, `crates/winbox-win16/tests/olecli.rs`).
