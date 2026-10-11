---
kind: function
module: USER
name: IsCharAlpha
ordinal: 433
summary: Whether a character is a letter of the Windows character set, accented letters included; its three siblings answer for letters and digits, capitals and small letters.
versions:
  '3.1': exact
probes: [queries, langdrv]
source: src/win16/user/queries.ts
topics: [small-queries]
---

## Observed behaviour

[[probe:queries]] asks `IsCharAlpha`, `IsCharAlphaNumeric`, `IsCharUpper` and `IsCharLower` of every one of the 256 characters. [[measured]]

- The letters are A to Z, a to z, 8Ah, 8Ch, 9Ah, 9Ch and 9Fh, and C0h to FFh but for D7h and F7h, the multiplication and division signs. 8Ah, 8Ch and 9Fh are capitals, and 9Ah and 9Ch small letters. From C0h, the capitals run to DEh and the small letters from DFh. AAh and BAh, the ordinal indicators, are not letters.
- DFh, `ß`, and FFh, `ÿ`, are small letters with no capital among the 256.
- `IsCharAlphaNumeric` adds the digits 0 to 9, and nothing else.

[[read out]] True is not 1. Each answers AX as USER's test leaves it (`USER.EXE` seg11 `024b`-`027a`): nought, or the character in AL and in AH the high byte of USER's data segment's selector, which the function's entry loads into AX to reach its data (`0215`). [[measured]] [[probe:langdrv]]: `IsCharAlpha('a')` answered 0A61h on the recording's installation, `IsCharAlphaNumeric('5')` 0A35h, `IsCharUpper('A')` 0A41h.

While a language driver is loaded, each hands the character to it instead and answers what it answers ([[topic:system-parameters]]).

winbox.js answers from the recorded tables, the high byte its own USER's data segment's selector's, and agrees with all four.
