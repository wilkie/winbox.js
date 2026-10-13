---
kind: function
module: USER
name: SendMessage
ordinal: 111
summary: Hands a message to a window's procedure and waits for its answer; with HWND_BROADCAST, to every window at the top, answering 10000h.
versions:
  '3.1': partial
probes: [bcast, dderaw]
topics: [system-parameters, several-programs, dynamic-data-exchange]
---

## Observed behaviour

- [[read out]] The export (`USER.EXE` seg1 `a786`) checks the window, unless it is `HWND_BROADCAST`, -1, which goes to the broadcast (`22e3`) unchecked.
- [[measured]] [[probe:bcast]]: with `HWND_BROADCAST`, every window at the top is handed the message, front to back as [[fn:USER.EnumWindows]] takes them -- hidden, disabled, minimized, owned and another program's alike -- but USER's own menus', task list's and icons' titles' windows; a child is not. The call answers 10000h whatever they answered. Another program's window is handed it as a message another task sent: [[fn:USER.InSendMessage]] is true in its procedure.
- [[measured]] `WM_WININICHANGE` and `WM_DEVMODECHANGE` with an `lParam` arrive with a copy of its text, at offset nought of a block of USER's, freed after.

- [[read out]] Before anything else it checks a message's parameters (seg1 `af70`, from `a7a1`): for the DDE messages, the `wParam` of `WM_DDE_INITIATE` must be a window. [[measured]] [[probe:dderaw]]: `WM_DDE_INITIATE` with a `wParam` of nought or 1234h answered nought and was handed to no one ([[topic:dynamic-data-exchange]]).

See [[topic:system-parameters]], "A program's broadcast".

## Implementation

`src/win16/user/broadcast.ts` and the Rust engine's `broadcast.rs` do the broadcast as USER does, and agree with all of [[probe:bcast]]'s records. Of USER's checks of the parameters, the DDE messages' are followed (`dde-checks.ts`, `dde_checks.rs`), and agree with [[probe:dderaw]].
