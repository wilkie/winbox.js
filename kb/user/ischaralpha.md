---
kind: function
module: USER
name: IsCharAlpha
ordinal: 433
summary: Whether a character is a letter of the Windows character set, accented letters included; its three siblings answer for letters and digits, capitals and small letters.
versions:
  '3.1': exact
probes: [queries]
source: src/win16/user/queries.ts
topics: [small-queries]
---

## Observed behaviour

[[probe:queries]] asks `IsCharAlpha`, `IsCharAlphaNumeric`, `IsCharUpper` and `IsCharLower` of every one of the 256 characters. [[measured]]

- The letters are A to Z, a to z, 8Ah, 8Ch, 9Ah, 9Ch and 9Fh, and C0h to FFh but for D7h and F7h, the multiplication and division signs. 8Ah, 8Ch and 9Fh are capitals, and 9Ah and 9Ch small letters. From C0h, the capitals run to DEh and the small letters from DFh. AAh and BAh, the ordinal indicators, are not letters.
- DFh, `ß`, and FFh, `ÿ`, are small letters with no capital among the 256.
- `IsCharAlphaNumeric` adds the digits 0 to 9, and nothing else.

winbox.js answers from the recorded tables, and agrees with all four.
