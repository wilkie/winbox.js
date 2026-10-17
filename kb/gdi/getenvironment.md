---
kind: function
module: GDI
name: GetEnvironment
ordinal: 133
summary: Copies the environment GDI keeps for a printer's port — the DEVMODE a driver left there — or answers its size.
versions:
  '3.1': exact
probes: [prdlg]
source: src/win16/gdi/environment.ts
topics: [printer-drivers]
---

## Observed behaviour

- [[measured]] The PostScript driver asks for the environment of its port as COMMDLG asks it for its DEVMODE; none kept, it reads WIN.INI ([[probe:prdlg]]).

## Inside Windows

[[read out]] `GDI.EXE` seg7 `0571`: the port's atom found, a colon at its end left off; on WIN.INI's `NullPort` the environment's device name instead. No slot of the twenty for it answers nought. With no buffer, the size of the block kept as `GlobalSize` answers it; else the bytes copied, no more than asked. See [[topic:printer-drivers]].

## Implementation

`src/win16/gdi/environment.ts` and `crates/winbox-win16/src/gdi/environment.rs`.
