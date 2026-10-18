---
kind: function
module: DDEML
name: MONITORWNDPROC
ordinal: 33
summary: The window procedure of a monitor instance's window, class DMGMonitorClass: each notice sent it becomes an XTYP_MONITOR callback.
probes: [ddemgmt, ddemon]
topics: [dynamic-data-exchange]
---

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `35f2`: `WM_CREATE` keeps the instance at its word 0; `WM_USER + CAh` (`3636`) calls the monitor back `XTYP_MONITOR`, `hData` the notice, `dwData2` the `MF_` flag in its high word, which is the notice's kind. The notices are sent by `SendMessage` from whichever task's DDEML made them (`3524`), each a block of `GMEM_DDESHARE` freed when every monitor has had it.

[[measured]] [[probe:ddemgmt]]: the probe's monitor was told `MF_HSZ_INFO`, `MF_ERRORS`, `MF_CONV` and `MF_CALLBACKS` from both programs, `MONHSZSTRUCT`'s `fsAction` 1 to 7, `MONERRSTRUCT` 10 bytes, `MONCONVSTRUCT` 26, `MONCBSTRUCT` 42, and the task of each. [[probe:ddemon]]: `MF_LINKS`, `MONLINKSTRUCT` 36 bytes, each link told by its server's side and its client's as it was made and as it ended, and `MF_SENDMSGS` and `MF_POSTMSGS`, `MONMSGSTRUCT` 18; a second monitor taking `MF_LINKS` and `MF_ERRORS` alone was handed those alone.

## Implementation

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation; this is its own, internal to it.
