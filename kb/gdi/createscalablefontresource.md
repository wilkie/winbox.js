---
kind: function
module: GDI
name: CreateScalableFontResource
ordinal: 310
summary: Writes the .FOT resource stub that lets AddFontResource install a TrueType file.
versions:
  '3.1': exact
probes: [fotmake]
---

## Observed behaviour

[[measured]] The file written is the [[format:fot]], every byte of which is determined by the `.TTF` and its path — five faces rebuilt byte for byte, 213 of 213 records.

## Inside Windows

[[read out]] `GDI.EXE` ordinal 310 validates three far pointers and returns with `retf 0xe`: fourteen bytes of arguments, as its prototype says. winbox.js had declared twelve.

## Implementation

The replay rebuilds each stub from the drive image's `.TTF` through the same function the API calls, `scalableFontResource`; the API adds only reading the `.TTF` and writing the result through the DOS file layer, which no probe exercises.
