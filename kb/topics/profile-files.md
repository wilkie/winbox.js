---
kind: topic
name: Profile files
summary: How the Windows 3.1 profile calls read and write an INI file — matching, whitespace, quotes, comments, numbers, the section list, how a loaded file is normalised in place, what a read and a write do to the caller's string and to the file, removing an entry or a section, and what KERNEL holds in memory and when it loads the file again.
probes: [profile, profnew, profhold, profnul]
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
- Not yet measured: a duplicated entry, a section header with space inside its brackets.

## Where the file is

- [[measured]] A name with no path is a file in the Windows directory, wherever the program runs from. [[probe:profnew]] runs in `C:\ORACLE`, writes `[S] k=440` to `PROFNEW.INI`, and finds the file in `C:\WINDOWS` and not in `C:\ORACLE`. A name with a path is the file it names: `C:\ORACLE\PROFNEW2.INI` is made there.
- [[measured]] Writing to a file that does not exist makes it, and the write answers 1. The new file holds the one section and entry, `[S]`, `k=440`, each line ended by a carriage return and a line feed. Reading the entry back gives 440, both straight after the write and after a flush.
- FIBS/W writes its window's first size to `FIBSW.INI` this way, then reads it back to size its window. winbox.js had answered 0 for a file not there, so FIBS/W read back the default of 350 rows and drew its window 90 rows short, 16,975 pixels unlike Windows' screen. Now only 14 pixels differ, which are explained under [[topic:dialog-boxes]].

## Writing

- [[measured]] A write changes the caller's own string: its trailing spaces are cut off in place. `"  both ends  "` is 13 characters before the write and 11 after it, and `"   "` becomes empty. Leading spaces stay, and so does a trailing tab — five records.
- [[measured]] The value goes into the file as `name=value`, with no quotes: `both=  both ends`, `leading=   leading only`, `blank=`. A trailing tab does not reach the file: `tabbed=tab`.
- [[measured]] A replaced entry keeps the name as the file spells it: writing `ENTRY` over `entry` leaves `entry=recased`. A new entry goes after the section's last entry. A new section goes after the last complete line of the file, after a blank line even where the file already ends in one, and a final line with no carriage return stays after it.
- [[read out]] Where exactly (`KRNL386.EXE` seg1 `6e49`-`6e7b`, `726a`): from the buffer's end, back over every carriage return and line feed to the last other byte; three bytes on from it -- that byte, a return and the byte taken for a line feed -- the section is put, with `\r\n` before its heading unless that is the buffer's start. What lay after stays after it: the blank lines the file ended in, or the line feed a value's return left behind (see the next section). [[measured]] Widget Workshop's installer adds sections to its `WIDGET.INI`, which ends in blank lines, and Windows' file is so, byte for byte (`test/layers/widget-windows.json`); `profile`'s snapshots are unchanged by the rule.
- [[measured]] The whole buffer is written back, not only the line that changed, so what loading did to every other line reaches the disk too.
- [[read out]] KERNEL measures each string it writes as it measures a value it reads (`KRNL386.EXE` seg1 `6864`, from `6e25`-`6e85`): to the first byte at or below `0Dh` -- the nought, a tab, a return -- and back over the spaces before it, writing the byte that ended it over the first of them, in the caller's string. That is the trailing spaces cut in place, and the trailing tab left in the caller's string but not written. It measures the value always, the entry's name where the entry is new, and the section's where the section is new. A value the buffer already holds is compared first, as the caller gave it, and left alone without being measured (`6df2`-`6e03`, `7150`).
- [[read out]] A replaced value is written from after the `=`, with a return and a line feed over the first two bytes of the old line's ending (`6e06`-`6e1a`, `72b5`). [[measured]] So the rest of an ending a read had cut stays: `spaced=padded value\r  \r\n` becomes `spaced=  untrimmed\r\n \r\n` ([[probe:profile]]).

## Removing an entry or a section

Read out of `KRNL386.EXE` seg1 `6cec`-`7088`, and recorded by [[probe:profnul]], whose 48 records agree. Each of its cases lays down a file of its own through the file API, makes one call, and records the answer and the file after it.

- [[read out]] [[fn:KERNEL.WritePrivateProfileString]] looks for the section first (`66ac`). Where it is missing, a NULL entry or a NULL value leaves the buffer as it is and answers 1 (`6d6f`-`6d82`, `707c`): nothing is written. [[measured]] The file keeps the spacing it was laid down with, which a write would have compacted (`missing`, `missing section`, `empty section null`). A section that is there and a NULL entry removes the section, whatever the value (`6d97`; `value given`). An entry that is not there and a NULL value leaves the buffer (`6db6`; `missing entry`, `empty entry null`); one that is there loses its line (`6deb`, `704b`).
- [[read out]] A section goes from the `[` of its heading -- the last on its line -- line by line, a line running to its line feed, up to a line that starts with `[` or the buffer's end (`71cb`-`7229`). A line that starts with `;` is kept and moved up to where the heading was; everything else goes, entries and blank lines alike. [[measured]] `[Gone]` with `x=1`, `; kept comment`, `y=two  ` and a blank line after it leaves `; kept comment` where `[Gone]` was. The blank line before the heading stays. The last section takes the file to its last byte, the first leaves the file starting at the second, and of two sections of the same name the first goes (`twice`: `D`'s `b` still reads `2` from the second).
- [[read out]] An entry goes from after the line feed before it to after the next (`722c`).
- [[read out]] As KERNEL loads a file it adds a return, a line feed and a nought after it, and it writes back the buffer less those three bytes (`6ca8`-`6cdf`, `70ef`-`710a`). [[measured]] So the last entry of a file whose last line has no ending takes those two bytes with it, and the two before it: `[A]`, `a=1`, `[B]`, `b=2` with no ending, `b` removed, is `[A]\r\na=1\r\n[B]` (`open entry`).
- [[measured]] An empty string is a string: an empty value writes `a=`, an empty entry's name writes `=v` and reads back, and an empty section's name writes `[]`.
- [[read out]] Nothing in the profile calls sends or posts a message (`WriteProfileString` is `6cec` on `WIN.INI`'s buffer). [[measured]] A window of the probe's is sent no `WM_WININICHANGE` across three `WriteProfileString` calls; a program that changes `WIN.INI` says so itself.
- [[measured]] SimTower's setup calls `WriteProfileString("WinG", NULL, NULL)`. On a `WIN.INI` without `[ProbeNul]`, `WriteProfileString("ProbeNul", NULL, NULL)` answers 1, and the file is the same length, without the section; written and then removed, the section is gone. WinBox had left an empty `[WinG]` heading where it removed the section's entries one by one.

## How a loaded file is normalised

Every rule here is from the eight snapshots of the file's bytes, and winbox.js reproduces each of them byte for byte.

- [[read out]] A line runs to a line feed: every step KERNEL takes from one line to the next is a scan for `0Ah` (`KRNL386.EXE` seg1 `66ac`, `6783`, `71cb`, `722c`). A value ends at the first byte at or below `0Dh`, a return normally (`6864`).
- [[measured]] Loading the file changes it in place. The whitespace at the start of every line is dropped, and on a line with an `=`, so is the whitespace before the `=` and after it: `after=   after only` becomes `after=after only` and `  indented  =  in  ` becomes `indented`, `=`, `in  `, in sections nothing wrote to. [[read out]] The rest of the line is copied as it was (`6c4a`-`6c68`).
- [[measured]] A value's trailing blanks stay as loading leaves them: [[probe:profnul]] lays down `y=  two  `, reads nothing, and a write elsewhere puts `y=two  ` back.
- [[read out]] A read cuts them, in the buffer: [[fn:KERNEL.GetPrivateProfileString]] measures the value it found (`6569`-`656c`, `6864`), writing the byte that ended it -- a return -- over the first trailing space. [[measured]] [[probe:profile]] reads its values before it writes, and the file it writes back has `ends=both ends`, a return, a space, and the old return and line feed; `one=x `, at the end of the file, `one=x`, a return, the old return, and the line feed.
- [[read out]] Every line with an `=` is compacted so, a comment's and a section header's too (seg1 `6b77`-`6c89`, in protected mode). [[measured]] A comment is never read, so it keeps its trailing blanks: Windows left Widget Workshop's `; cmixit=0 (default) ` so, its blanks around `=` gone and its trailing one kept (`widget-windows.json`). WinBox does so.
- [[measured]] Lines without an `=`, the section headers among them, keep the rest of their bytes: `[Odd]   ` and `bare line  ` are written back as they were, and `[Odd]   ` still opens `Odd`.
- [[measured]] This happens once, when the file is loaded, and not again while the buffer is held: a value written with its leading spaces stays in the file with them until the file is loaded again, when it too is normalised.
- A file whose lines end in line feeds alone is not yet measured. [[read out]] Its lines are lines to KERNEL's steps, but a value runs on past the line feed to the next return.

[[read out]] KERNEL writes a changed profile back lazily: at a task switch, before a program's DOS call, at the end of Windows, and when [[fn:KERNEL.WriteOutProfiles]] asks ([[topic:kernel-internals]]). WinBox writes at once, which a program cannot tell apart.

## What a write leaves in memory

- [[measured]] Straight after a write, the value reads back as it was written, leading spaces and all: `"  both ends"`, though the file holds it unquoted and the reader trims those spaces from anything it parses.
- [[measured]] After `WritePrivateProfileString(NULL, NULL, NULL, file)`, which returns 0, the same entries read back as the file parses: `both ends`, `leading only`, `untrimmed`, `tab` — five of five.
- [[measured]] Reading `WIN.INI` in between does not do that: a value written after the flush still read back with its leading spaces after `WIN.INI` was read.
- [[read out]] [[measured]] So the buffer a write leaves behind is what every read and write after it works on, until KERNEL loads the file again. When it does is in the next section.

## What KERNEL holds, and when it loads the file again

Read out of `KRNL386.EXE` seg1 and recorded by [[probe:profhold]], whose twelve records agree. Each of its cases writes a value with leading spaces and reads it back: the spaces say whether the buffer the write left answered, or the file loaded again.

- [[read out]] KERNEL holds two buffers: one for `WIN.INI` and one for a private file (`636b`: the name `WIN.INI`, or Windows' own path for it, picks `ds:03e4`; any other name `ds:047e`). A name without a path is the file in the Windows directory; the private buffer keeps the whole path and compares it without regard to case.
- [[read out]] [[measured]] A read leaves its buffer held too, not only a write. The private buffer is let go when a profile call names another private file (`63e7`-`6438`, `6b33`): a value written, then a read of `PROFHLD2.INI`, then the value read back gives it trimmed. The same file named by its whole path, `C:\WINDOWS\PROFHOLD.INI`, keeps the buffer, and so does reading `WIN.INI` in between.
- [[read out]] Every DOS call sets a flag, in KERNEL's handler of `INT 21h` (`1b68`), whatever the function. A profile call that finds the flag set and its file held asks DOS for the file's date and time (function 4Eh, `630f`-`635b`) and lets the buffer go where they are not those KERNEL opened the file with; then it clears the flag (`6363`). With no buffer held the flag stays set.
- [[read out]] A buffer written is not put on the disk at once: the next DOS call, from any program, writes every buffer written since (`1b6d`-`1b8c`, `WriteOutProfiles` `708b`). That opens the file again first (`70a7`, `OF_REOPEN`), which takes the file's stamp from before the write, and the write gives the file a new one. Writes with no DOS call between them go out together.
- [[measured]] DOS keeps a file's time to two seconds, so a value written reads back with its leading spaces while DOS's clock is in the same two seconds as the file's last stamp, and trimmed once it has moved on and a DOS call has been made. The probe waits for DOS's clock (`INT 21h` 2Ch) to step before each case: a value written in the same two seconds as the file was made, or last written, keeps its spaces after a DOS call (`made`, `same-step`, `same-again`); one written in the next two seconds does not (`next-step`, `then-dos`); and one read back with no DOS call in between keeps them whenever it was written (`no-dos`).
- [[measured]] A change made to the file by DOS itself, `_lwrite` on it, is not seen while its stamp stays in the same two seconds as the stamp the buffer was opened with: `[Raw2] q` reads as missing straight after it was appended, and as `2` after the next step of the clock.
- [[measured]] Program Manager's `PROGMAN.INI` shows the same rule between two programs: the probe reads `Order=` trimmed after Program Manager's first write since it started, and with Program Manager's leading space after the writes that follow ([[probe:progdde]]). [[read out]] Its start-up write of `display.drv=` is no write at all, the value being the file's: KERNEL leaves an unchanged value alone ([[fn:KERNEL.WritePrivateProfileString]]), so the first write since it started is its first CreateGroup's.
- winbox.js follows this: KERNEL's two buffers, the flag as any DOS call since the profile calls last looked, and the stamp each buffer was opened with. It writes the file at once rather than at the next DOS call, and keeps the stamp from before the first of writes with no DOS call between them. A file written is stamped with DOS's clock, as DOS stamps it.

## Numbers

- [[measured]] [[fn:KERNEL.GetPrivateProfileInt]] reads leading digits and stops (`40two` is 40), reads a minus into an unsigned result (`-1` is 65535), and does not remove quotes (`"7"` is 0). A present value with no digits — `none`, or empty — is 0; only a missing entry or section gives the default.

## Truncation and the section list

- [[measured]] A value too long for the buffer is cut to the buffer less one and terminated; the count is what was kept. See [[fn:KERNEL.GetPrivateProfileString]].
- [[measured]] With no entry named, the answer is every entry name in file order, each ending in a null; the count covers the names and their nulls. A list too long is cut to the buffer less **two**, still ending its last name with a null.

The derivations are in `oracle/README.md` under "The profile probe"; [[guide:reproducing]] says how to record it again.
