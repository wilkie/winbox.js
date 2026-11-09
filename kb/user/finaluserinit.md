---
kind: function
module: USER
name: FinalUserInit
ordinal: 400
summary: USER's last step as Windows starts: its own drawing context and bitmap made, and GDI's FinalGDIInit called.
versions:
  '3.1': unrecorded
source: crates/winbox-win16/src/user_internals.rs
topics: [user-internals]
---

## Observed behaviour

- Not measured. Called a second time in Windows it would make a second memory context and bitmap.

## Inside Windows

- [[read out]] `USER.EXE` seg3 `2570`-`2638`: a boot log line ("Final USER", seg3 `0238` with 0 and 1); `CreateCompatibleDC` of the screen's context, kept at 1BAh; a monochrome bitmap 28h times `[522h]` wide and `[52Ah]` + 2 high, kept at 1B8h and selected into it; its text colour, background mode and colour set; brushes and fonts selected; then GDI's `FinalGDIInit` (GDI 405) with the brush at 1B6h.

## Callers

- No file of the installations or the corpus imports it (`kb/data/user-callers.json`).

## Implementation

An exact no-op (`crates/winbox-win16/src/user_internals.rs`): WinBox's USER has done its own start, and its drawing needs no such context. Nothing a program can ask shows the context or the bitmap.
