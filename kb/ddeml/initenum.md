---
kind: function
module: DDEML
name: INITENUM
ordinal: 38
summary: The EnumWindows procedure DDEML connects with: it sends WM_DDE_INITIATE to each window at the top, until one answers or, for a list, to every one.
probes: [ddemgmt]
topics: [dynamic-data-exchange]
---

## Inside Windows

[[read out]] `DDEML.DLL` seg1 `6b8a`: given the client's window, its conversation and the topic, it notes the window it sends to, sends `WM_DDE_INITIATE` with the conversation's service and the topic, and answers to go on where the conversation is a list's or no one has acknowledged yet. [[fn:DDEML.DdeConnect]] and [[fn:DDEML.DdeConnectList]] hand it to [[fn:USER.EnumWindows]] (`6b4f`-`6b5a`); there is no broadcast.

[[measured]] [[probe:ddemgmt]]: connections made this way, across two programs, agree with Windows in both engines.

## Implementation

DDEML is Microsoft's `DDEML.DLL`, loaded from the installation; this is its own, internal to it.
