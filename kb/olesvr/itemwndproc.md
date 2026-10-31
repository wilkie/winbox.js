---
kind: function
module: OLESVR
name: ITEMWNDPROC
ordinal: 23
summary: "The window procedure of `ItemWndClass`, the class of the windows `OLESVR.DLL` keeps an object's clients in."
versions:
  '3.1': partial
probes: [olesrv]
source: src/win16/olesvr/index.ts
topics: [ole]
---

## Nuances

- [[measured]] As WinBox ran `OLESVR.DLL` from the drive, its entry registered `ItemWndClass` with this procedure and four bytes of window words, and its calls (`EnumChildWindows`, `SetProp`, `GetProp`, `EnumProps`) show it keeping each object's clients on windows of the class beneath a document's. No probe sees them.

## Implementation

WinBox's own registers the class and answers its messages with `DefWindowProc`; it keeps an object's conversations beside guest memory and makes no item windows ([[topic:ole]], "Not yet done").
