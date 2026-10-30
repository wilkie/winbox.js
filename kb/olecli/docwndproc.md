---
kind: function
module: OLECLI
name: DOCWNDPROC
ordinal: 100
summary: 'The window procedure of `OleDocWndClass`, the class of the windows a document talks DDE through.'
versions:
  '3.1': partial
probes: [oledde]
topics: [ole]
---

## Nuances

- [[measured]] As WinBox ran `OLECLI.DLL` from the drive, its entry registered `OleDocWndClass` with this procedure, no style and four bytes of window words.

## Observed behaviour

- [[measured]] [[probe:oledde]]: an object's conversation is held through a window of `OleDocWndClass`, made hidden as the conversation begins with the object's far pointer in its window words: `WM_DDE_ACK`, `WM_DDE_DATA` and `WM_DDE_TERMINATE` from its server answer the step its object waits for, or tell it its object changed, was saved or closed. Other messages go to `DefWindowProc`.

## Implementation

WinBox's own: `convProc` in `src/win16/olecli/linked.ts` and `conv_proc` in `crates/winbox-win16/src/olecli/linked.rs` ([[topic:ole]], "Embedded and linked objects").
