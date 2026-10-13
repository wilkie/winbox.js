---
kind: function
module: USER
name: PostMessage
ordinal: 110
summary: Puts a message in the queue of the program that made a window; with HWND_BROADCAST, in the queue of every window at the top that has no owner, answering ABCDh.
versions:
  '3.1': partial
probes: [bcast, postend]
topics: [system-parameters, several-programs]
---

## Observed behaviour

- [[read out]] The export (`USER.EXE` seg1 `a7b7`) checks the window, unless it is `HWND_BROADCAST`, -1, which goes to the broadcast (`22e3`) unchecked. Posting, the broadcast walks the desktop's children in order and posts to each that has no owner (`232b`-`234e`), passing over USER's own menus', task list's and icons' titles' windows (`2293`), and answers ABCDh (`2353`).
- [[measured]] [[probe:bcast]]: the shown, hidden, disabled and minimized windows at the top, and another program's, were each posted it; the owned ones, shown or hidden, and a child, were not. The call answered ABCDh.
- [[measured]] `WM_WININICHANGE` with an `lParam` arrives with a copy of its text, at offset nought of a block of USER's: [[read out]] never freed.

- [[read out]] Before posting, the export hands the message to USER's validation of message parameters (`af70`), which for the DDE messages checks `wParam` and `lParam`'s low word (`b31a`-`b385`): `WM_DDE_INITIATE`, `WM_DDE_ADVISE`, `WM_DDE_UNADVISE`, `WM_DDE_ACK`, `WM_DDE_DATA` and `WM_DDE_REQUEST` need a window in `wParam`; `WM_DDE_ADVISE` a handle in `lParam`, `WM_DDE_DATA` and `WM_DDE_POKE` nought or a handle. A refused message is not posted and the call answers nought. [[measured]] [[probe:postend]]: `WM_DDE_ACK`, `WM_DDE_INITIATE` and `WM_DDE_DATA` posted with `wParam` nought never arrive; 3DFh, `WM_DDE_TERMINATE`, `WM_DDE_EXECUTE` and 3E9h do. The same check stops a DDE message at [[fn:USER.DispatchMessage]] once its sender's window is gone.

See [[topic:system-parameters]], "A program's broadcast".

## Implementation

`src/win16/user/broadcast.ts` and the Rust engine's `broadcast.rs` do the broadcast as USER does, and agree with all of [[probe:bcast]]'s records. The DDE messages' rows of the validation are `src/win16/user/dde-parameters.ts` and `dde_parameters.rs`; the other rows are not followed.
