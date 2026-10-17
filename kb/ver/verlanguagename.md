---
kind: function
module: VER
name: VerLanguageName
ordinal: 10
summary: A language's name from VER's string table, "Unknown Language" for a number with none, cut to the buffer; the whole name's length answered.
versions:
  '3.1': exact
probes: [verinfo]
source: src/win16/ver/ver.ts
topics: [version-information]
---

## Observed behaviour

[[probe:verinfo]] asks for 16 languages into buffers of 100, 5 and 1 bytes.

- [[measured]] The name of each number VER has one for: 409h `U.S. English`, 407h `German`, 40Ch `French`, 411h `Japanese`, 804h `Simplified Chinese`, 809h `U.K. English`, C0Ch `Canadian French`, 100Ch `Swiss French`, 41Ah `Croato-Serbian (latin)`, 81Ah `Serbo-Croatian (cyrillic)`, 421h `Bahasa`.
- [[measured]] Nought, 400h, 422h, 9999h and 10Ch give `Unknown Language`.
- [[measured]] The answer is the name's whole length, whatever the buffer; the name is cut to the buffer's size less one, with its nought: `U.S.` in 5 bytes, nothing in 1.

## Nuances

- [[read out]] The arguments: the language, a far pointer to the buffer, its size; it pops 8 bytes and answers a `UINT`.
- [[read out]] A size of nought writes the whole name: the cut is made at the size less one only where the size is no more than the length, and a size of nought cuts at the byte before the buffer.

## Inside Windows

[[read out]] `VER.DLL` seg3 `1599`: `LoadString` of VER's own instance with the language as the string's number, into 102h bytes on the stack; none, string nought's. Where the size is no more than the length, a nought at the size less one; then `lstrcpy` into the buffer. The names are VER's string tables 1, 65-67, 129, 130, 193 and 257: 45 languages, and string nought.

## Implementation

`VerLanguageName` in `src/win16/ver/ver.ts` and `ver_language_name` in `crates/winbox-win16/src/ver/mod.rs`, from the names copied out of VER's string tables (`src/win16/ver/languages.ts`, `crates/winbox-win16/src/ver/languages.rs`). Both engines agree with [[probe:verinfo]], with `VER.DLL` on the drive and without it.
