---
kind: function
module: USER
name: AnsiUpper
ordinal: 431
summary: Uppercases a string in place in the ANSI character set, or a single character passed in place of the pointer.
versions:
  '3.1': exact
probes: [strings]
topics: [string-collation]
---

## Observed behaviour

- [[documented]] A pointer whose high word is zero is taken as one character in its low byte, and the converted character is returned instead of written.
- [[measured]] 9 of 9 recorded conversions agree. See [[probe:strings]].
- [[measured]] Letters convert; the digits, spaces and punctuation recorded do not: `"MiXeD 123"` gives `"MIXED 123"`, `"with-punctuation!"` gives `"WITH-PUNCTUATION!"`.
- [[measured]] The accented letters convert: `à é ü` (0xE0 0xE9 0xFC) give `À É Ü` (0xC0 0xC9 0xDC), and those uppercase letters come back unchanged.
- [[measured]] `ß` (0xDF) is left alone, and so are `÷` (0xF7) and `×` (0xD7).

## Nuances

- [[inferred]] The last two are the trap: 0xF7 sits among the lowercase accented letters, so subtracting 0x20 across the block turns a division sign into a multiplication sign. See [[topic:string-collation]].
- Not yet measured: `ÿ` (0xFF), whose uppercase in the codepage is not 0x20 away; the single-character form; any other language driver.

## Implementation

Subtracts 0x20 from `a`–`z` and from 0xE0–0xFE except 0xF7, leaving everything else. 0xFF is left alone for want of a measurement.
