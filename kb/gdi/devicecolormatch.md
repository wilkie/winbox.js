---
kind: function
module: GDI
name: DeviceColorMatch
ordinal: 449
summary: The nearest colour in a driver's table of colours to a colour, by the sum of the squares of the differences, answering a word of the matching entry.
versions:
  '3.1': exact
probes: [gdiint]
records: [colormatch]
source: src/win16/gdi/system-exports.ts
topics: [gdi-internals]
---

## Observed behaviour

[[probe:gdiint]] builds a table of five colours and asks for colours near each.

- [[measured]] `DeviceColorMatch(crColor, lpDevice)` -- the colour first. `lpDevice` points at a word, the offset of the word to answer in each entry, and a far pointer to the table: a count, a word, then ten bytes an entry with blue, green and red at 6, 7 and 8.
- [[measured]] The entry whose squared differences of red, green and blue add up to the least is chosen, the first of any alike; an exact one ends the search. Its word at the offset is answered. The colour's top byte is not looked at.

## Inside Windows

[[read out]] `GDI.EXE` seg11 `1015`: the colour's three bytes rearranged and passed with the table's pointer to seg22 `0b2b`, the nearest-entry search `GetNearestPaletteIndex` shares, which sums each square into seventeen bits (`0b4b`-`0b74`) and keeps the least (`0b84`-`0b96`). The entry's number is the word at the start of the table's segment less the entries left (`0b9e`), so the table must start its segment. Then the word at the device's offset in that entry (`103a`-`1050`). `retf 8`.

## Callers

[[read out]] None imports it (`kb/data/gdi-callers.json`).

## Implementation

In both engines as read out. [[probe:gdiint]] agrees in both.

**Recommendation:** done.
