---
kind: function
module: GDI
name: GetCurLogFont
ordinal: 411
summary: Answers the handle of the logical font selected into a device context.
versions:
  '3.1': exact
probes: [dcinner]
topics: [device-context-internals]
---

## Observed behaviour

- [[measured]] A new memory device context answers the System font's handle, the stock object's; with a font of the program's selected, that font's ([[probe:dcinner]]).

## Inside Windows

[[read out]] `GDI.EXE` seg1 `511a` reads the word at the context's 16h, without asking whether the handle is a device context's.

## Implementation

The handle of the font selected; nought for a handle that is no device context, where Windows would read whatever the handle's block held. [[probe:dcinner]] agrees in both.
