---
kind: function
module: KERNEL
name: GetPrivateProfileInt
ordinal: 127
summary: Reads one entry of a named INI file as an unsigned number, returning a supplied default when the entry is missing.
versions:
  '3.1': exact
probes: [profile]
source: src/win16/kernel/GetPrivateProfileInt.ts
topics: [profile-files]
---

## Observed behaviour

- [[measured]] All 8 records of [[probe:profile]] agree with Windows.
- [[measured]] `42` reads as 42. `40two` reads as 40: the digits at the start are kept and the rest ignored.
- [[measured]] `-1` reads as 65535: a leading minus is honoured and the result is unsigned 16-bit.
- [[measured]] The default (99) comes back only when the entry or the section is missing — two records.

## Nuances

- [[measured]] A value that is present but gives no digits reads as 0, not the default: `none`, an empty value, and `"7"` all give 0.
- [[measured]] So quotes are not removed here, though [[fn:KERNEL.GetPrivateProfileString]] removes them from `"  kept  "` in the same probe. See [[topic:profile-files]].
- Not yet measured: leading spaces or a plus sign before the digits, a number beyond 65535, hexadecimal.

## Implementation

`toInteger` in `src/win16/kernel/profiles.ts` holds the conversion, and its rules come from the recording.
