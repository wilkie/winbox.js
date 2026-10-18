---
kind: function
module: DDEML
name: DDEPOSTHOOKPROC
ordinal: 35
summary: DDEML's WH_GETMESSAGE hook, put in with the first monitor: each DDE message a task takes from its queue, told to the monitors as MF_POSTMSGS.
versions:
  '3.1': exact
probes: [ddemon]
source: src/win16/ddeml/monitor.ts
topics: [dynamic-data-exchange]
---

## Observed behaviour

- [[measured]] [[probe:ddemon]]: a monitor taking `MF_POSTMSGS` was told each posted DDE message as the receiving task took it -- a client's `WM_DDE_REQUEST` by the server's task, the server's `WM_DDE_DATA` or `WM_DDE_ACK` after its callback, by the client's -- each an 18-byte `MONMSGSTRUCT`, `hTask` the receiving window's task.

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `309e`: for a message from 3E0h to 3E8h, a `MONMSGSTRUCT` -- the message's own time -- sent to the monitors that take `MF_POSTMSGS`; then on with [[fn:USER.DefHookProc]]. A posted message is told as it is taken, by `GetMessage` or `PeekMessage`, not as it is posted. Both of DDEML's hooks keep the hook before them in one word, `[3Ah]`, so the second put in, this one first, has its own overwritten.

## Implementation

WinBox's own: `postHook` in `src/win16/ddeml/monitor.ts` and `post_hook` in `crates/winbox-win16/src/ddeml/monitor.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. It is WinBox's own export, put in by [[fn:USER.SetWindowsHook]] as the first monitor is made. Both engines agree with [[probe:ddemon]], with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
