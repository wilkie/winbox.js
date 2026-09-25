---
kind: topic
name: Profile files
summary: How the Windows 3.1 profile calls read and write an INI file — matching, whitespace, quotes, comments, numbers, the section list, what a write does to the caller's string and to the file, and what it leaves in memory until a flush.
probes: [profile]
---

The profile calls share one reading of the file. [[probe:profile]] writes its own `PROBE.INI` before asking anything, so every case below is a line whose exact bytes are known; the `WIN.INI` cases are the exception. It also records the file, line by line, as the writes left it. Of 92 records, 59 are replayed and agree with winbox.js; the 33 lines of the file are not replayed yet.

## Matching

- [[measured]] Section and entry names match without regard to case: the entry `MiXeD` is found as `mixed` and as `MIXED`, and `[Plain]` as `PLAIN` and `plain` — four records, each the stored value.
- [[measured]] The first `=` on a line ends the name: `equals=a=b` reads as `a=b`.

## Values

- [[measured]] Whitespace around a value is dropped: `spaced   =   padded value   ` reads as `padded value`, 12 characters. Where the spaces are makes no difference: after the `=` only, before it only, on both sides, a tab after it, and spaces at both ends of the value all read back trimmed, five of five.
- [[measured]] One pair of quotes is removed and what is inside them kept whole, for either quote character: `"  kept  "` and `'  also  '` both read back as 8 characters with their spaces.
- [[measured]] A semicolon starts a comment only at the start of a line. `semicolon=;` reads as `;`, and the line `; a comment line` is not listed when the section is enumerated.
- [[measured]] An entry that is present with nothing after `=` reads as an empty string, count 0, not as the default.

## What is missing

- [[measured]] A missing entry and a missing section both give the default, as do an absent `WIN.INI` section through [[fn:KERNEL.GetProfileString]]. An empty default gives count 0.
- Not yet measured: a file that does not exist, a duplicated entry, a section header with space inside its brackets.

## Writing

- [[measured]] A write changes the caller's own string: its trailing spaces are cut off in place. `"  both ends  "` is 13 characters before the write and 11 after it, and `"   "` becomes empty. Leading spaces stay, and so does a trailing tab — five records.
- [[measured]] The value goes into the file as `name=value`, with no quotes: `both=  both ends`, `leading=   leading only`, `blank=`. A trailing tab does not reach the file: `tabbed=tab`.
- [[measured]] A new entry goes at the end of its section, after the last entry, and a new section at the end of the file.
- [[measured]] The whole file is rewritten, not only the line that changed. A section nothing wrote to comes back normalised: `after=   after only` becomes `after=after only`, and `before   =before only` becomes `before=before only`.
- [[measured]] Rewriting a line whose value had trailing spaces left debris behind: a line holding a single space after `spaced=  untrimmed`, and `ends=both ends` followed by a carriage return and a space before its line ends. Not yet explained.

## What a write leaves in memory

- [[measured]] Straight after a write, the value reads back as it was written, leading spaces and all: `"  both ends"`, though the file holds it unquoted and the reader trims those spaces from anything it parses.
- [[measured]] After `WritePrivateProfileString(NULL, NULL, NULL, file)`, which returns 0, the same entries read back as the file parses: `both ends`, `leading only`, `untrimmed`, `tab` — five of five.
- [[inferred]] So a write is kept in memory as written, and the reads see it there until the file is flushed. The recording read `WIN.INI` before flushing, so whether reading another file flushes it too is not separated.

## Numbers

- [[measured]] [[fn:KERNEL.GetPrivateProfileInt]] reads leading digits and stops (`40two` is 40), reads a minus into an unsigned result (`-1` is 65535), and does not remove quotes (`"7"` is 0). A present value with no digits — `none`, or empty — is 0; only a missing entry or section gives the default.

## Truncation and the section list

- [[measured]] A value too long for the buffer is cut to the buffer less one and terminated; the count is what was kept. See [[fn:KERNEL.GetPrivateProfileString]].
- [[measured]] With no entry named, the answer is every entry name in file order, each ending in a null; the count covers the names and their nulls. A list too long is cut to the buffer less **two**, still ending its last name with a null.

The derivations are in `oracle/README.md` under "The profile probe"; [[guide:reproducing]] says how to record it again.
