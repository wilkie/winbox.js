---
kind: function
module: USER
name: InSendMessage
ordinal: 192
summary: Whether the message a window procedure is handling was sent to it by another program.
versions:
  '3.1': partial
probes: [queries, bcast]
source: src/win16/user/queries.ts
topics: [several-programs, small-queries]
---

## Observed behaviour

- [[read out]] It answers the task's queue's word at 38h (`USER.EXE` seg1 `3dba`): nought outside a message another task sent; while one is handled, the sending task's queue (`3ba4`-`3c2d`), and 1 once it is answered with [[fn:USER.ReplyMessage]] (`3c7e`).
- [[measured]] Nought for a message the program sent itself, one posted, and outside any message ([[probe:queries]]); true in another program's window procedure for a message sent it, as `SendMessage` with `HWND_BROADCAST` sends ([[probe:bcast]]).

## Implementation

winbox.js has no queues' handles, and answers 1 while a task handles a message another sent it.
