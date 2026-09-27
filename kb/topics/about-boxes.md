---
kind: topic
name: About boxes
summary: The About box every Windows 3.1 accessory shows through SHELL's ShellAbout — its caption and lines, where each comes from, and how the memory and resources free are worked out — read out of SHELL.DLL and recorded while the box is up.
probes: [about]
---

Every accessory's **Help > About** calls [[fn:SHELL.ShellAbout]] with its own name, a line of its own, and its icon. SHELL shows its dialog 100 and fills it in (`SHELL.DLL` seg9 `0136`). [[probe:about]] calls it four ways. A timer reads every control while the box is up, then closes it. All 9 records agree with winbox.js.

## The caption and the first line

- [[measured]] With a name such as `Probe`, the caption is `About Probe` and the first line is `Microsoft Windows Probe`. Both come from templates in the dialog, `About %s` and `Microsoft Windows %s`.
- [[measured]] A name with a `#` is split there. `Caption#Line` gives the caption `Caption` and the line `Microsoft Windows Line`, and `#Line only` gives an empty caption.
- [[measured]] **The `#` is written over in the caller's own string** and never put back. The probe's string reads `Caption` after the call.
- [[measured]] The program's own text is shown as it is, over two lines if it has a line break. No text shows as nothing.
- [[measured]] The icon given is shown at the top left. With none, its control is hidden. [[read out]] SHELL then paints its Windows logo there instead: bitmap 130, 64 pixels square, at (10,10) in device pixels.
- [[measured]] ShellAbout answers 1: any command closes the box with 1.

## The other lines

- [[measured]] The version line is `Version 3.1 `, with a **trailing space**. [[read out]] The template is `Version %s %s`, filled with USER's string 204h and, on a debugging Windows only, `(Debug)`.
- [[measured]] The licensee's name and company are USER's strings 202h and 203h, each padded with spaces to 30 characters, shown padding and all. Setup stamps them into USER.EXE. The serial number line is USER's string 205h.
- [[measured]] The mode line is `Standard Mode`. [[read out]] It is `386 Enhanced Mode` when `GetWinFlags` has no `WF_STANDARD`. The real-mode lines are never reached on 3.1.
- [[measured]] The memory line is `GetFreeSpace(1000h)` in kilobytes, `%s KB Free`, with its thousands separated. [[read out]] The kilobytes are truncated, not rounded, and the separator is the first character of `WIN.INI`'s `[intl]` `sThousand`, a comma when it has none.
- [[measured]] The template's `Expanded Memory` label becomes `System Resources:`, and its value is `GetFreeSystemResources(0)` as `%d%% Free`. The `SMARTDrive Using` line is hidden.
- [[measured]] The two numbers move while the box is being made, so the probe records each as agreeing when it is written that way and within a little of what the calls answer at the moment it reads it.

## Free system resources

- [[read out]] [[fn:USER.GetFreeSystemResources]] takes each of USER's three local heaps and GDI's, asks `GetHeapSpaces` for its size and free space, and works out the free kilobytes a hundred times over the size's, truncated (`USER.EXE` seg41 `1740`). 0 answers the least of the four, 1 answers GDI's, and 2 the least of USER's.
- [[measured]] Freshly started, with one program running, Windows answers 88, 88 and 96.

## In winbox.js

`src/win16/shell/about.ts` is `ShellAbout`. The dialog template and SHELL's strings are winbox.js's own: `about-dialog.ts` and `strings.ts` beside it are generated from the installation by `scripts/oracle/dialog-template.mjs` and `scripts/oracle/strings-table.mjs`. The logo is read from the installation's `SHELL.DLL` when it is wanted, as the display's artwork is.

Not followed:
- winbox.js keeps no heaps for USER and GDI, so `GetFreeSystemResources` answers the recorded 88, 88 and 96. The figures do not fall as windows and objects are made.
- `GetFreeSpace` answers 16 MB.
- The credits hidden behind a double click are not shown.
