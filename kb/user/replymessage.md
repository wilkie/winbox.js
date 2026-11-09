---
kind: function
module: USER
name: ReplyMessage
ordinal: 115
summary: A message another task sent answered before its procedure returns.
versions:
  '3.1': exact
probes: [replym]
records: [child, insend, own]
topics: [several-programs]
source: crates/winbox-win16/src/reply_message.rs
---

## Observed behaviour

- [[measured]] [[probe:replym]]: the sender's `SendMessage` answers what `ReplyMessage` was given, 42, not what the procedure returns after, 99; a second `ReplyMessage` changes nothing. `InSendMessage` is still non-nought after it. In a message the task sent itself, or one posted, it does nothing.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `3c37`-`3c96`: where the queue holds a sender (`[38h]` over 1), the answer put in the sender's queue, `[38h]` set to 1, the sender woken and the processor handed to it with `DirectedYield`. As the procedure returns, a message already answered is not answered again.

## Implementation

`crates/winbox-win16/src/reply_message.rs`. The scheduler keeps each message another task sent while it is answered (`Scheduler.takeSent`, `take_sent`).
