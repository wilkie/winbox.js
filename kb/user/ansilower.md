---
kind: function
module: USER
name: AnsiLower
ordinal: 432
summary: Lowercases a string in place in the ANSI character set, or a single character passed in place of the pointer.
versions:
  '3.1': exact
probes: [strings]
topics: [string-collation]
---

## Observed behaviour

- [[documented]] A pointer whose high word is zero is taken as one character in its low byte, and the converted character is returned instead of written.
- [[measured]] 9 of 9 recorded conversions agree. See [[probe:strings]].
- [[measured]] `"HELLO"` gives `"hello"` and `"MiXeD 123"` gives `"mixed 123"`; digits, spaces and punctuation are untouched.
- [[measured]] `À É Ü` (0xC0 0xC9 0xDC) give `à é ü` (0xE0 0xE9 0xFC), and the lowercase letters come back unchanged.
- [[measured]] `×` (0xD7), `÷` (0xF7) and `ß` (0xDF) are all left alone.

## Nuances

- [[inferred]] 0xD7 sits among the uppercase accented letters, so adding 0x20 across the block would turn a multiplication sign into a division sign. See [[topic:string-collation]] and [[fn:USER.AnsiUpper]].
- Not yet measured: the single-character form and any other language driver.

## Implementation

Adds 0x20 to `A`–`Z` and to 0xC0–0xDE except 0xD7, leaving everything else.
