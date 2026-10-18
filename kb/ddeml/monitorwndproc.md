---
kind: function
module: DDEML
name: MONITORWNDPROC
ordinal: 33
summary: The window procedure of a monitor instance's window, class DMGMonitorClass: each notice sent it becomes an XTYP_MONITOR callback.
versions:
  '3.1': exact
probes: [ddemgmt]
source: src/win16/ddeml/monitor.ts
topics: [dynamic-data-exchange]
---

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `35f2`: `WM_CREATE` keeps the instance at its word 0; `WM_USER + CAh` (`3636`) calls the monitor back `XTYP_MONITOR`, `hData` the notice, `dwData2` the `MF_` flag in its high word, which is the notice's kind. The notices are sent by `SendMessage` from whichever task's DDEML made them (`3524`), each a block of `GMEM_DDESHARE` freed when every monitor has had it.

[[measured]] [[probe:ddemgmt]]: the probe's monitor was told `MF_HSZ_INFO`, `MF_ERRORS`, `MF_CONV` and `MF_CALLBACKS` from both programs, `MONHSZSTRUCT`'s `fsAction` 1 to 7, `MONERRSTRUCT` 10 bytes, `MONCONVSTRUCT` 26, `MONCBSTRUCT` 42, and the task of each.

## Implementation

WinBox's own: `monitorProc` in `src/win16/ddeml/monitor.ts` and `monitor_proc` in `crates/winbox-win16/src/ddeml/monitor.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. It is WinBox's own export, the procedure of the `DMGMonitorClass`; each notice is the `GMEM_DDESHARE` block `send_notice` (`sendNotice`), seg1 `3524`, sends. Both engines agree with [[probe:ddemgmt]], with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
