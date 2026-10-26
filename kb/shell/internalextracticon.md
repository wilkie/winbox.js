---
kind: function
module: SHELL
name: InternalExtractIcon
ordinal: 39
summary: A fixed block of a file's icons' handles, from an index on; with -1, the count; nought where no block is made.
versions:
  '3.1': exact
probes: [iextract]
records: [extract]
source: src/win16/shell/programs.ts
topics: [user-internals]
---

## Observed behaviour

- [[read out]] `SHELL.DLL` seg10 `026e`-`0881`. Nought where the file cannot be opened, no icons are asked for, or two bytes cannot be read. Else a fixed block of a word an icon, zeroed (`02c4`-`02e7`); its first word 1, or nought for -1, unless set after. An icon file sets the first word alone. A program for Windows 3 sets a word an icon from the index on, each its group's member for the display (USER's `GetIconID`, `071d`) made an icon (`LoadIconHandler`, `07a3`), and stops at the first group there is not; with -1 the first word is how many groups it has. An older program sets the first word alone. [[fn:SHELL.ExtractIcon]] is this of one icon, its word, the block freed (`021a`-`026a`).
- [[measured]] [[probe:iextract]]: Program Manager's icons from 0, three, three icons; from 1, two; -1 its count, 2Eh, then nought; from its last, the icon and nought; none asked for, and a file not there, nought; WIN.INI 1 and nought, or with -1 nought.

## Implementation

`src/win16/shell/programs.ts` (`extractIcons`), and the Rust engine's `shell/programs.rs`.
