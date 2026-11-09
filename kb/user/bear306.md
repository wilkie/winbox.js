---
kind: function
module: USER
name: Bear306
ordinal: 306
summary: The window procedure of USER's class #32768, the menus' pop-up windows.
versions:
  '3.1': unrecorded
probes: [userproc]
source: crates/winbox-win16/src/window_queries.rs
topics: [user-internals]
---

## Observed behaviour

- [[measured]] [[probe:userproc]]: `GetClassInfo` of `#32768` gives this export's address for the class's procedure. WinBox registers `#32768` only on the raster desktop, as it makes USER's own windows, so the record is a known gap of the replay.

## Inside Windows

- [[read out]] `USER.EXE` seg10 `1587`: USER's data segment loaded into DS itself (`158e`), the window's menu state looked up (seg2 `0b27`), and a switch on `WM_CREATE`, `WM_DESTROY`, the paint messages and the menus' own: the pop-up's drawing and tracking.

## Callers

- No file of the installations or the corpus imports it (`kb/data/user-callers.json`).

## Implementation

The procedure WinBox's own `#32768` windows have, `DefWindowProc`: WinBox's menus draw and track their pop-ups themselves, and the class's windows are USER's hidden ones. `crates/winbox-win16/src/user.rs`'s table; `crates/winbox-win16/src/user_internals.rs`.
