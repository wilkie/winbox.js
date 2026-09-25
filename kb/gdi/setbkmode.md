---
kind: function
module: GDI
name: SetBkMode
ordinal: 2
summary: Sets whether text and hatched brushes paint the background colour behind themselves.
versions:
  '3.1': exact
probes: [textbk, smeargnd]
topics: [text-ground-and-rules]
---

## Observed behaviour

- [[measured]] `OPAQUE` paints the ground in the background colour; `TRANSPARENT` paints nothing behind the glyphs. A fresh device context is `OPAQUE`. See [[topic:text-ground-and-rules]].

## Implementation

The replays of [[probe:textbk]] and [[probe:smeargnd]] set the mode through this call, as the probes did, and every record agrees. Until this was written, winbox.js had the implementation at ordinal 487 of its GDI table, which Windows 3.1 does not export, and a stub at 2, so a program calling `SetBkMode` reached the stub. It now sits at 2. The previous mode it returns is not recorded.
