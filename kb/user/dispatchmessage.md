---
kind: function
module: USER
name: DispatchMessage
ordinal: 114
summary: Hands a message taken from the queue to its window's procedure, or to its timer's; a DDE message whose sender's window is gone is not handed on.
versions:
  '3.1': partial
probes: [postend]
topics: [several-programs]
---

## Observed behaviour

- [[measured]] [[probe:postend]]: a program posts this one `WM_DDE_ACK`, giving its own window in `wParam`, and ends. The message is never handed to the window it was posted to, whether the program ended straight from `WinMain`, through its message loop after `WM_CLOSE`, or by posting itself `WM_CLOSE` while handling a message, as Program Manager does for `[ExitProgman]`. A `WM_USER + 1` posted the same way is handed on each time, and so is the `WM_DDE_ACK` of a program that stays.
- [[measured]] So a DDEML client waiting on Program Manager's `[ExitProgman(0)]` is never acknowledged ([[topic:program-manager-dde]]).

## Nuances

- [[read out]] The export (`USER.EXE` seg1 `a6fb`) hands the message to USER's validation of message parameters (`af70`, called at `a727`) before dispatching it. For the DDE messages that validation wants a window in `wParam`, and for some a handle in `lParam` ([[fn:USER.PostMessage]] lists the rows). A refused message is not dispatched: the call goes to KERNEL's `HandleParamError` with 7007h and answers nought (`a72e`-`a739`).
- [[read out]] USER's own loops — a dialog box's, the menus', a scroll bar's — dispatch without that validation, so the check is the export's alone.

## Implementation

`src/win16/user/DispatchMessage.ts` asks `dde-checks.ts` before `dispatchMessage`, which USER's own loops call; the Rust engine's `dispatch_message` in `queue.rs` asks `dde_checks.rs` before `Engine::dispatch`. The other rows of the validation are not followed.
