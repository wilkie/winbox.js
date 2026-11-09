---
kind: function
module: USER
name: LookupMenuHandle
ordinal: 217
summary: The menu an item of a command is in: the menu given, or one it opens.
versions:
  '3.1': exact
probes: [usermore]
records: [lookup]
topics: [menus]
source: crates/winbox-win16/src/small_calls.rs
---

## Observed behaviour

- [[measured]] [[probe:usermore]], on a menu bar with a pop-up, and a pop-up inside that:
  - A command of the bar's own items: the bar. Of the pop-up's: the pop-up. Of the inner pop-up's: the inner pop-up -- asked of the bar or of the pop-up.
  - A command in both pop-ups, the outer's last item and the inner's: the outer pop-up.
  - A command of none, and -1: nought.

## Inside Windows

- [[read out]] `USER.EXE` seg9 `0163`: the item found as USER finds one by its command (seg10 `009c`), from the menu's last item to its first, a pop-up's own menu searched where the pop-up item is; the menu the item was found in answered.

## Implementation

`crates/winbox-win16/src/small_calls.rs`.
