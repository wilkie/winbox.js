---
kind: function
module: GDI
name: CreateFontIndirect
ordinal: 57
summary: Creates a logical font from a LOGFONT; the face, size and style it maps to are decided when it is selected and used.
versions:
  '3.1': exact
probes: [font, tiepick, tiewide, rotsize, symadv]
topics: [turned-text, synthetic-bold]
---

## Observed behaviour

- [[measured]] The request is matched against the installed strikes and TrueType faces by a scored competition, with the character set outranking the face name. See [[fonts:2]].
- [[measured]] Where two sizes tie for a requested cell, the tie is settled by the metrics, not the pixels. See [[fonts:8r]].
- [[measured]] A weight above 550 on a face that has no heavier file is smeared; above 600 a family's bold file is chosen. See [[topic:synthetic-bold]].
- [[read out]] A non-zero escapement changes the competition: the exact-match arm is skipped, raster candidates that would need synthesis are penalised, and a TrueType face is sized by the turned rule. See [[topic:turned-text]].
