---
kind: function
module: GDI
name: GetRasterizerCaps
ordinal: 313
summary: Reports whether TrueType is installed and enabled.
versions:
  '3.1': unrecorded
---

## Implementation

It reports `TT_AVAILABLE` and `TT_ENABLED`, which is what an installation with TrueType fonts answers, and a language identifier of 1, which is a placeholder: no probe has recorded what Windows 3.1 returns.
