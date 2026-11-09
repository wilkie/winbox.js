---
kind: function
module: SHELL
name: AboutDlgProc
ordinal: 33
summary: The About box's procedure, filled from the block ShellAbout hands DialogBoxParam.
versions:
  '3.1': exact
probes: [aboutdp]
records: [made, answer]
source: crates/winbox-win16/src/shell/about.rs
topics: [user-internals]
---

## Observed behaviour

- [[read out]] `SHELL.DLL` seg9 `0136`-`0725`. `WM_INITDIALOG` reads the block `ShellAbout` hands `DialogBoxParam` (seg9 `0000`-`004d`): the icon at 0, the program's name at 2, the other text at 6; the name up to a `#` is the caption and the rest the line under it, else "About" and the name. `WM_PAINT` draws the Windows logo where no icon is shown; `WM_COMMAND` ends the box. Nought for any other message.
- [[measured]] [[probe:aboutdp]]: a box of the probe's own from SHELL's template 100, given the procedure and such a block: its caption, its line and its other text as `ShellAbout` shows them; the icon's control hidden with no icon and shown with one; nought for `WM_TIMER`.

## Implementation

`src/win16/shell/about.ts`, and the Rust engine's `shell/about.rs`; `ShellAbout` uses the same procedure.
