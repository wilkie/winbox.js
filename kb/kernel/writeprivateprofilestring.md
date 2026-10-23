---
kind: function
module: KERNEL
name: WritePrivateProfileString
ordinal: 129
summary: Sets, adds or removes one entry of a named INI file, creating the section when it is missing.
versions:
  '3.1': exact
probes: [profile, profnew, profhold, pmshell]
source: src/win16/kernel/WritePrivateProfileString.ts
topics: [profile-files]
---

## Observed behaviour

- [[measured]] All 13 of its records in [[probe:profile]] agree with Windows: 6 writes read back, 6 that record the caller's string, and the flush — and the eight snapshots of the file's bytes after its writes, byte for byte. Each write returned 1 and was read back through [[fn:KERNEL.GetPrivateProfileString]].
- [[measured]] A new entry in an existing section (`added`), a replaced entry (`entry`) and an entry in a new section (`[Fresh] first`) each read back as written.
- [[measured]] A NULL value removes the entry: reading `added` back afterwards gives the default.
- [[measured]] After all five writes, `[Plain]` lists the same 13 names in the same order as before them, so the replaced `entry` and `spaced` stayed in place and the removed `added` left nothing behind.

## Nuances

- [[measured]] The caller's string is changed: trailing spaces are cut off in place, by a null over the first of them. `"trailing only   "` is 16 characters before the write and 13 after; `"   "` becomes empty. Leading spaces and a trailing tab stay — five records, and the first recording showed it by accident, printing its own `"  untrimmed  "` after the write as `"  untrimmed"`.
- [[measured]] The value is written unquoted, as `name=value`, with its leading spaces and without a trailing tab. A replaced entry keeps the file's spelling of its name; a new section goes after the last complete line, after a blank line. The whole buffer is written back, as loading normalised it. See [[topic:profile-files]].
- [[measured]] Straight after the write, the entry reads back as written, leading spaces included, and still does after `WIN.INI` is read. After a flush it reads back as the file parses, without them.
- [[read out]] A value the same as the one the buffer holds, byte for byte up to the line's end, is left alone: nothing in the buffer changes, nothing is written, and the answer is 1 (`KRNL386.EXE` seg1 `6df2`-`6e03`, `7150`, `707c`). [[measured]] Program Manager writes its `display.drv=` as it starts; where the file has the same, `PROGMAN.INI` is not rewritten, and the installation's `Order= 2 3 1` keeps its space ([[probe:pmshell]]), and the next program to read the file reads it as loaded, not as written ([[probe:progdde]]).
- [[measured]] `WritePrivateProfileString(NULL, NULL, NULL, file)` flushes, and returns 0.
- [[measured]] A file that does not exist is made, and the write returns 1. A name with no path is made in the Windows directory, not where the program runs; a name with a path is made where it says ([[probe:profnew]]).
- [[read out]] [[measured]] The file reaches the disk at the next DOS call any program makes, not during the call, and the buffer stays held after it. The file is loaded again — and a value's leading spaces trimmed — only when a later profile call finds the file's stamp changed since KERNEL opened it, which DOS's two-second clock decides, or when another private file is named ([[probe:profhold]], [[topic:profile-files]]).
- Not yet measured: a NULL entry.

## Implementation

winbox.js cuts the caller's trailing spaces in place, edits the loaded buffer through `Profile.set` in `src/win16/profile.ts`, writes it back whole at once, and holds it (`writeProfile` in `src/win16/kernel/profiles.ts`) with the file's stamp from before the write, as KERNEL's write-out keeps it, until KERNEL would let it go.
