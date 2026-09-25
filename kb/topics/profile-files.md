---
kind: topic
name: Profile files
summary: How the Windows 3.1 profile calls read and write an INI file — matching, whitespace, quotes, comments, numbers, the section list, how a loaded file is normalised in place, what a write does to the caller's string and to the file, and what stays in memory until a flush.
probes: [profile]
---

The profile calls share one reading of the file. [[probe:profile]] writes its own `PROBE.INI` before asking anything, so every case below is a line whose exact bytes are known; the `WIN.INI` cases are the exception. It also records the file's bytes after each write. All 114 records agree with winbox.js, the eight snapshots of the file byte for byte.

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
- [[measured]] A replaced entry keeps the name as the file spells it: writing `ENTRY` over `entry` leaves `entry=recased`. A new entry goes after the section's last entry. A new section goes after the last complete line of the file, after a blank line even where the file already ends in one, and a final line with no carriage return stays after it.
- [[measured]] The whole buffer is written back, not only the line that changed, so what loading did to every other line reaches the disk too.

## How a loaded file is normalised

Every rule here is from the eight snapshots of the file's bytes, and winbox.js reproduces each of them byte for byte.

- [[measured]] A line ends at a carriage return, and the byte after the return is taken to be the line feed without being looked at.
- [[measured]] Loading the file changes it in place. The whitespace at the start of every line is dropped, and on a line with an `=`, so is the whitespace before the `=` and after it: `after=   after only` becomes `after=after only` and `  indented  =  in  ` becomes `indented=in`, in sections nothing wrote to.
- [[measured]] A value's trailing whitespace is not removed. A carriage return is written over the first of it, and that return is where the line now ends, so the rest of the whitespace and the old line ending are left behind as a short line of their own: `ends=  both ends  ` becomes `ends=both ends`, a return, a space, and then the old return and line feed. `one=x ` at the end of the file becomes `one=x`, a return, the old return, and a line feed that is now a final line with no return of its own.
- [[measured]] Lines without an `=`, the section headers among them, keep the rest of their bytes: `[Odd]   ` and `bare line  ` are written back as they were, and `[Odd]   ` still opens `Odd`.
- [[measured]] This happens once, when the file is loaded, and not again while the buffer is held: a value written with its leading spaces stays in the file with them until the file is loaded again, when it too is normalised.
- [[inferred]] A line feed on its own is not a line ending to this reading, so a file whose lines end in line feeds alone would be one line to it. Not yet measured.

## What a write leaves in memory

- [[measured]] Straight after a write, the value reads back as it was written, leading spaces and all: `"  both ends"`, though the file holds it unquoted and the reader trims those spaces from anything it parses.
- [[measured]] After `WritePrivateProfileString(NULL, NULL, NULL, file)`, which returns 0, the same entries read back as the file parses: `both ends`, `leading only`, `untrimmed`, `tab` — five of five.
- [[measured]] Reading `WIN.INI` in between does not do that: a value written after the flush still read back with its leading spaces after `WIN.INI` was read.
- [[inferred]] So the buffer a write leaves behind is what every read and write after it works on, until the flush loads the file again. Whether a read alone leaves a buffer behind, and whether reading a third file lets it go, are not yet measured.

## Numbers

- [[measured]] [[fn:KERNEL.GetPrivateProfileInt]] reads leading digits and stops (`40two` is 40), reads a minus into an unsigned result (`-1` is 65535), and does not remove quotes (`"7"` is 0). A present value with no digits — `none`, or empty — is 0; only a missing entry or section gives the default.

## Truncation and the section list

- [[measured]] A value too long for the buffer is cut to the buffer less one and terminated; the count is what was kept. See [[fn:KERNEL.GetPrivateProfileString]].
- [[measured]] With no entry named, the answer is every entry name in file order, each ending in a null; the count covers the names and their nulls. A list too long is cut to the buffer less **two**, still ending its last name with a null.

The derivations are in `oracle/README.md` under "The profile probe"; [[guide:reproducing]] says how to record it again.
