---
kind: function
module: USER
name: SendMessage
ordinal: 111
summary: Hands a message to a window's procedure and waits for its answer; with HWND_BROADCAST, to every window at the top, answering 10000h.
versions:
  '3.1': partial
probes: [bcast]
topics: [system-parameters, several-programs]
---

## Observed behaviour

- [[read out]] The export (`USER.EXE` seg1 `a786`) checks the window, unless it is `HWND_BROADCAST`, -1, which goes to the broadcast (`22e3`) unchecked. The message is then checked by USER's validation of message parameters, as [[fn:USER.PostMessage]]'s is: a DDE message without a window in `wParam` is not sent, and the call answers nought (`a7a1`, `af70`).
- [[measured]] [[probe:bcast]]: with `HWND_BROADCAST`, every window at the top is handed the message, front to back as [[fn:USER.EnumWindows]] takes them -- hidden, disabled, minimized, owned and another program's alike -- but USER's own menus', task list's and icons' titles' windows; a child is not. The call answers 10000h whatever they answered. Another program's window is handed it as a message another task sent: [[fn:USER.InSendMessage]] is true in its procedure.
- [[measured]] `WM_WININICHANGE` and `WM_DEVMODECHANGE` with an `lParam` arrive with a copy of its text, at offset nought of a block of USER's, freed after.

See [[topic:system-parameters]], "A program's broadcast".

## Implementation

`src/win16/user/broadcast.ts` and the Rust engine's `broadcast.rs` do the broadcast as USER does, and agree with all of [[probe:bcast]]'s records.
