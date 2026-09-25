---
kind: function
module: USER
name: lstrcmpi
ordinal: 471
summary: Orders two strings the way the language driver sorts them, treating the two cases of a letter as the same.
versions:
  '3.1': exact
probes: [strings]
topics: [string-collation]
---

## Observed behaviour

- [[documented]] The sign of the result says which string sorts first, ignoring case; the language driver decides the order.
- [[measured]] 11 of 11 recorded comparisons agree. See [[probe:strings]].
- [[measured]] `"a"` against `"A"` is zero both ways round, where [[fn:USER.lstrcmp]] separates them.
- [[measured]] `"Zebra"` against `"apple"` is positive; `"_"` and `"1"` against `"a"` are negative; `"abc"` sorts before `"abd"` and `"abcd"`.
- [[inferred]] Every record agrees with the first step of the rule `lstrcmp` follows: compare the lowercased strings and stop there. See [[topic:string-collation]].

## Nuances

- [[measured]] The probe records only the sign of the result.
- Not yet measured: whether accented letters of the two cases compare equal, and a double-byte character set.

## Implementation

Lowercases both strings and compares character values. The lowercasing is JavaScript's rather than [[fn:USER.AnsiLower]]'s, which agree on everything recorded.
