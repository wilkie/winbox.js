---
kind: function
module: USER
name: PostMessage
ordinal: 110
summary: Puts a message in the queue of the program that made a window; with HWND_BROADCAST, in the queue of every window at the top that has no owner, answering ABCDh.
versions:
  '3.1': partial
probes: [bcast]
topics: [system-parameters, several-programs]
---

## Observed behaviour

- [[read out]] The export (`USER.EXE` seg1 `a7b7`) checks the window, unless it is `HWND_BROADCAST`, -1, which goes to the broadcast (`22e3`) unchecked. Posting, the broadcast walks the desktop's children in order and posts to each that has no owner (`232b`-`234e`), passing over USER's own menus', task list's and icons' titles' windows (`2293`), and answers ABCDh (`2353`).
- [[measured]] [[probe:bcast]]: the shown, hidden, disabled and minimized windows at the top, and another program's, were each posted it; the owned ones, shown or hidden, and a child, were not. The call answered ABCDh.
- [[measured]] `WM_WININICHANGE` with an `lParam` arrives with a copy of its text, at offset nought of a block of USER's: [[read out]] never freed.

See [[topic:system-parameters]], "A program's broadcast".

## Implementation

`src/win16/user/broadcast.ts` and the Rust engine's `broadcast.rs` do the broadcast as USER does, and agree with all of [[probe:bcast]]'s records.
