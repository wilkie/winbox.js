---
kind: function
module: USER
name: PostMessage
ordinal: 110
summary: Puts a message in the queue of the program that made a window; with HWND_BROADCAST, in the queue of every window at the top that has no owner, answering ABCDh.
versions:
  '3.1': partial
probes: [bcast, dderaw]
topics: [system-parameters, several-programs, dynamic-data-exchange]
---

## Observed behaviour

- [[read out]] The export (`USER.EXE` seg1 `a7b7`) checks the window, unless it is `HWND_BROADCAST`, -1, which goes to the broadcast (`22e3`) unchecked. Posting, the broadcast walks the desktop's children in order and posts to each that has no owner (`232b`-`234e`), passing over USER's own menus', task list's and icons' titles' windows (`2293`), and answers ABCDh (`2353`).
- [[measured]] [[probe:bcast]]: the shown, hidden, disabled and minimized windows at the top, and another program's, were each posted it; the owned ones, shown or hidden, and a child, were not. The call answered ABCDh.
- [[measured]] `WM_WININICHANGE` with an `lParam` arrives with a copy of its text, at offset nought of a block of USER's: [[read out]] never freed.
- [[read out]] Otherwise it checks the window and the message's parameters (seg1 `af70`, from `a7d2`): a handle that is no window's, or a DDE message whose parameters USER refuses, answers nought and is posted nowhere ([[topic:dynamic-data-exchange]]).
- [[read out]] It answers where it put the message: the offset of its entry in the task's queue, whose ring starts at 6Eh, 22 bytes an entry (`5480`, `54db`), eight entries unless `SetMessageQueue` made another size (`5326`). A full ring answers nought, and the message is lost (`5502`). Taking a message closes the gap: the ones before it move up and the ring's start with them, or, where the ring had wrapped before it, the ones after it move down (`55f9`-`5640`).
- [[measured]] [[probe:dderaw]]: posts answered 110, 132, 154 and on, 22 apart, wrapping after 264; ten posted to a program that had not run answered eight places and then nought twice, and it took eight.
- [[read out]] A message from 390h to 3B0h posted to the same window, and of the same number, as the last waiting takes that one's place (`23e4`-`23ff`, `237c`).

See [[topic:system-parameters]], "A program's broadcast".

## Implementation

`src/win16/user/broadcast.ts` and the Rust engine's `broadcast.rs` do the broadcast as USER does, and agree with all of [[probe:bcast]]'s records. A task's ring of eight is kept as its places alone, the messages in their order beside it (`Task.ringPlace`, `Queue::ring_place`), and agrees with all of [[probe:dderaw]]'s records.
