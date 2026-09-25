---
kind: topic
name: String collation
summary: How Windows 3.1's string comparisons and case conversions follow the language driver rather than byte values, and where in the ANSI range that matters.
probes: [strings]
---

Windows 3.1 compares and converts strings through the language driver. With the US driver the result looks like byte arithmetic for most of ASCII and parts from it in two places: mixed case, and the accented range.

## Comparison

- [[measured]] [[fn:USER.lstrcmp]] puts `"Zebra"` after `"apple"`, which a byte comparison puts first ('Z' is 0x5A, 'a' 0x61). It also puts `"a"` after `"A"`, and `"_"` (0x5F) before `"a"`. 11 of 11 comparisons in [[probe:strings]] agree with winbox.js.
- [[inferred]] The rule that fits them: compare the lowercased strings; only where they tie, compare the original character values, so the uppercase string sorts first. [[fn:USER.lstrcmpi]] is the first step alone, and its 11 records agree with that.
- [[refused]] Folding to uppercase instead fits `"Zebra"` against `"apple"` but gets `"_"` against `"a"` backwards: 0x5F is above 'A' (0x41). One of the eleven records rules it out.
- Not yet measured: how accented letters sort against each other and against ASCII, and how punctuation orders beyond `"_"` and `"1"` against `"a"`.

## Case in the ANSI range

- [[measured]] [[fn:USER.AnsiUpper]] and [[fn:USER.AnsiLower]] convert `à é ü` (0xE0 0xE9 0xFC) and `À É Ü` (0xC0 0xC9 0xDC) into each other, 18 of 18 records agreeing.
- [[measured]] Neither converts `ß` (0xDF), `÷` (0xF7) or `×` (0xD7).
- [[inferred]] Each of those three sits where a range check is easy to get wrong. The two signs sit inside the accented blocks, 0x20 apart, so subtracting or adding 0x20 across a block turns one into the other; 0xDF sits just below the lowercase block, where an off-by-one bound would convert a letter that has no one-character uppercase.
- Not yet measured: `ÿ` (0xFF), whose uppercase in the codepage is 0x9F, and every language driver but the US one.
