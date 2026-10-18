---
kind: function
module: DDEML
name: INITENUM
ordinal: 38
summary: The EnumWindows procedure DDEML connects with: it sends WM_DDE_INITIATE to each window at the top, until one answers or, for a list, to every one.
versions:
  '3.1': exact
probes: [ddemgmt]
source: src/win16/ddeml/conv.ts
topics: [dynamic-data-exchange]
---

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `6b8a`: given the client's window, its conversation and the topic, it notes the window it sends to, sends `WM_DDE_INITIATE` with the conversation's service and the topic, and answers to go on where the conversation is a list's or no one has acknowledged yet. [[fn:DDEML.DdeConnect]] and [[fn:DDEML.DdeConnectList]] hand it to [[fn:USER.EnumWindows]] (`6b4f`-`6b5a`); there is no broadcast.

[[measured]] [[probe:ddemgmt]]: connections made this way, across two programs, agree with Windows in both engines.

## Implementation

WinBox's own: `initEnum` in `src/win16/ddeml/conv.ts` and `init_enum` in `crates/winbox-win16/src/ddeml/conv.rs` follow `DDEML.DLL` as read out above, on guest memory laid out as the file lays it out and USER's and KERNEL's calls made as it makes them. It is WinBox's own export, handed to [[fn:USER.EnumWindows]] with the state laid out below the stack. Both engines agree with [[probe:ddemgmt]], with `DDEML.DLL` on the drive and without it (`test/win16/ddeml_test.ts`, `crates/winbox-win16/tests/ddeml.rs`).
