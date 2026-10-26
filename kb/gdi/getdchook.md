---
kind: function
module: GDI
name: GetDCHook
ordinal: 191
summary: Answers the data of a device context's hook and writes its procedure.
versions:
  '3.1': exact
probes: [dcinner]
topics: [device-context-internals]
---

## Observed behaviour

- [[measured]] A new memory device context has neither: nought, and nought written ([[probe:dcinner]]).
- [[measured]] A window's device context, lent by `GetDC`, has USER's `DCHOOK` for its procedure and data of USER's own.

## Inside Windows

[[read out]] `GDI.EXE` seg31 `04b5` writes the dword at the context's C4h where the pointer is not nought, and answers the dword at C8h. What a lent context has there is USER's: `DCHOOK`, and data of its own ([[measured]] [[probe:dcinner]]).

## Implementation

In both engines as read out. A window's context has USER's `DCHOOK`, the address `GetProcAddress` gives for it, and for data its own handle, standing for USER's cache entry. [[probe:dcinner]] agrees in both.
