---
kind: function
module: USER
name: EndMenu
ordinal: 187
summary: The menu open ended, whatever window's it is.
versions:
  '3.1': exact
probes: [endmenu]
topics: [menus]
source: src/win16/user/small-calls.ts
---

## Observed behaviour

- [[measured]] [[probe:endmenu]]: called from the window's first `WM_ENTERIDLE` while `TrackPopupMenu` has a pop-up open, the menu ends: `WM_MENUSELECT` with FFFFh, no `WM_COMMAND`, `TrackPopupMenu` answers 1, and no window has the capture after. With no menu open it returns.

## Inside Windows

- [[read out]] `USER.EXE` seg9 `00fe`-`0162`: where a menu is open (`[0D0h]`), the menu mode ended, the capture released where the menu's window has it, and the menu's loop ended (seg10 `1132`, or `0db2` where its window is gone). `DefWindowProc`'s `WM_CANCELMODE` calls it for a window's own menu (seg1 `5d27`-`5d3a`).

## Implementation

`src/win16/user/small-calls.ts`; the Rust engine's `crates/winbox-win16/src/small_calls.rs`.
