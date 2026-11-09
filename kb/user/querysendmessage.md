---
kind: function
module: USER
name: QuerySendMessage
ordinal: 184
summary: The message another task sent that the task is answering.
versions:
  '3.1': exact
probes: [replym]
records: [query]
topics: [several-programs]
source: crates/winbox-win16/src/reply_message.rs
---

## Observed behaviour

- [[measured]] [[probe:replym]]: 1, and the window, the message, `wParam` and `lParam` written; nought in a message the task sent itself or was posted, and nought with a first handle not nought.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `490e`-`4980`: nought unless all three handles are nought and `InSendMessage` answers non-nought; then the sender's queue's copy of the message, at 1Eh of the queue `InSendMessage` names, written to the `MSG`'s first four fields.

## Nuances

- [[read out]] After [[fn:USER.ReplyMessage]], `InSendMessage` answers 1, and the sender's queue is read from a selector of 1, which faults. WinBox answers nought then.

## Implementation

`crates/winbox-win16/src/reply_message.rs`. The scheduler keeps each message another task sent while it is answered (`take_sent`).
