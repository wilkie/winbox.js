---
kind: function
module: USER
name: lstrcmp
ordinal: 430
summary: Orders two strings the way the language driver sorts them, with case deciding only between strings that otherwise tie.
versions:
  '3.1': exact
probes: [strings]
topics: [string-collation]
---

## Observed behaviour

- [[documented]] The sign of the result says which string sorts first; the language driver, not the byte values, decides the order.
- [[measured]] 11 of 11 recorded comparisons agree. See [[probe:strings]].
- [[measured]] It is not a byte comparison: `"Zebra"` against `"apple"` is positive, where `'Z'` (0x5A) against `'a'` (0x61) would make it negative.
- [[measured]] Case still counts, lowercase last: `"a"` against `"A"` is positive and `"A"` against `"a"` negative.
- [[measured]] `"_"` against `"a"` and `"1"` against `"a"` are both negative; `"abc"` sorts before `"abd"` and before `"abcd"`; equal strings, empty ones included, give zero.
- [[inferred]] One rule fits all eleven: compare the lowercased strings, and only if they tie, compare the original character values. Folding to uppercase instead gets `"_"` against `"a"` backwards. See [[topic:string-collation]].

## Nuances

- [[measured]] The probe records only the sign; how large the result is was never recorded.
- Not yet measured: the accented range, digits and punctuation against each other, and a double-byte character set.

## Implementation

Compares the lowercased strings by character value and falls back to the unfolded values on a tie. The lowercasing is JavaScript's, which matches the driver's only where it has been measured. See [[fn:USER.lstrcmpi]].
