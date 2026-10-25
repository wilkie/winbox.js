---
kind: function
module: USER
name: SetSystemMenu
ordinal: 280
summary: A window given a system menu: the menu's first item's pop-up.
versions:
  '3.1': partial
probes: [usermisc]
records: [sysmenu]
topics: [menus]
source: src/win16/user/small-calls.ts
---

## Observed behaviour

- [[measured]] [[probe:usermisc]]: 1 for a window with a system menu box; nought for a child without one. [[fn:USER.GetSystemMenu]] then answers the menu's first item's pop-up -- none, for a menu of plain items.

## Inside Windows

- [[read out]] `USER.EXE` seg9 `0041`-`007c`: for a window with `WS_SYSMENU`, the system menu it had destroyed, the menu given kept in its place (`[3Ah]`) and brought up to the window's state (seg17 `0000`), and 1; else nought. `GetSystemMenu` answers that menu's first item's pop-up (seg9 `0f44`-`0f54`).

## Implementation

`src/win16/user/small-calls.ts`; the Rust engine's `crates/winbox-win16/src/small_calls.rs`. Not followed: the menu it had destroyed.
