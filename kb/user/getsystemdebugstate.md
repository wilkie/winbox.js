---
kind: function
module: USER
name: GetSystemDebugState
ordinal: 231
summary: What the system is in the middle of, for a debugger, as bits.
versions:
  '3.1': exact
probes: [sysdbg]
records: [state]
topics: [dialog-boxes, menus]
source: crates/winbox-win16/src/small_calls.rs
---

## Observed behaviour

- [[measured]] [[probe:sysdbg]], as a double word:
  - Nought with the program's own window active, in a dialog's `WM_INITDIALOG`, after a dialog has ended, and after each state below is over.
  - 8, `SDS_DIALOG`, with a modal or modeless dialog shown -- but not where the dialog's procedure answers `WM_ACTIVATE` itself.
  - 1, `SDS_MENU`, in `WM_INITMENUPOPUP` while `TrackPopupMenu` has its pop-up open.
  - 10h, `SDS_TASKLOCKED`, after [[fn:USER.LockMyTask]] with TRUE.
  - 2, `SDS_SYSMODAL`, after `SetSysModalWindow`, until that window is destroyed.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `4afb`-`4b58`: 4, `SDS_NOTASKQUEUE`, where the current task has no queue; then 1 for the word at `[1CAh]`, set as a menu's loop starts (seg17 `0188`); 8 for `[0DAh]`; 10h for `[0DEh]`, the flag `LockMyTask` was given (seg1 `6f05`); 2 for `[0E2h]`, the system-modal window.
- [[read out]] `[0DAh]` is `DefDlgProc`'s: a dialog activated sets it, one deactivated clears it (seg25 `050b`-`0511`, `WM_ACTIVATE` whose procedure left it to `DefDlgProc`), and one destroyed clears it (`0621`, `WM_NCDESTROY`).

## Implementation

`crates/winbox-win16/src/small_calls.rs`. `DefDlgProc` keeps the dialog's word (`crates/winbox-win16/src/dialogs.rs`). Never `SDS_NOTASKQUEUE`: a task here always has a queue.
