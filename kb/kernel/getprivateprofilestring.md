---
kind: function
module: KERNEL
name: GetPrivateProfileString
ordinal: 128
summary: Looks up one entry of a named INI file and copies its value — or, with no entry named, the list of a section's entry names — into a caller's buffer.
versions:
  '3.1': exact
probes: [profile]
source: src/win16/kernel/GetPrivateProfileString.ts
topics: [profile-files]
---

## Observed behaviour

- [[measured]] All 34 of its records in [[probe:profile]] agree with Windows: 29 reads, and 5 read again after a flush.
- [[measured]] The count returned is the length of what was written, without its null: `value` is 5, `padded value` 12, an empty value 0.
- [[measured]] Lookups ignore case on the section and the entry, drop the whitespace around a value, and remove one pair of single or double quotes. See [[topic:profile-files]].
- [[measured]] A missing entry or section copies the default: `<default>` gives 9 in both records.

## Nuances

- [[measured]] A short buffer keeps its size less one and a null. For `value`: size 6 gives 5, size 5 gives `valu` and 4, size 2 gives `v` and 1, size 1 gives an empty string and 0. The default is cut the same way: `<default>` in 4 bytes is `<de`, 3.
- [[measured]] With a NULL entry the buffer holds the section's entry names in file order, each null-terminated. `[Second]` gives `only` and a count of 5; `[Plain]` gives its 13 names and 100, leaving out its comment and blank lines; a missing section gives 0.
- [[measured]] A truncated list is cut to the buffer less two: `[Second]` in 6 bytes gives `onl` and its null, count 4.
- [[inferred]] The second byte held back is for the list's closing null; the record shows only the bytes the count covers.
- [[measured]] A value written since the last flush reads back as written, not as the file would parse it: see [[fn:KERNEL.WritePrivateProfileString]].
- Not yet measured: a file that does not exist, an unterminated quote, the list form on a section with duplicate names.

## Implementation

winbox.js reads the whole file through its `Profile` class (`src/win16/profile.ts`) on each call and copies out through `copyOut` and `copyOutList` in `src/win16/kernel/profiles.ts`.
