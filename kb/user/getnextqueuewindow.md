---
kind: function
module: USER
name: GetNextQueueWindow
ordinal: 274
summary: The next window Alt+Escape would take, or the one before.
versions:
  '3.1': exact
probes: [usermisc]
records: [queue]
topics: [activation-and-focus]
source: crates/winbox-win16/src/small_calls.rs
---

## Observed behaviour

- [[measured]] [[probe:usermisc]]: of two overlapped windows, each answers the other, forwards and back; a child answers as its top-level window.

## Inside Windows

- [[read out]] `USER.EXE` seg23 `0c3f`-`0ce6`: from the window's top-level window, `GetWindow` with `GW_HWNDNEXT` (or `GW_HWNDPREV`), round to the desktop's first child (or its last) at the end. Passed over: USER's task list, a window not visible, one whose last active pop-up is disabled, and one that is not the last active pop-up of the window at the root of its owners -- an unowned one must be its own. Nought where it comes round to the window it started from.

## Implementation

`src/win16/user/small-calls.ts`; the Rust engine's `crates/winbox-win16/src/small_calls.rs`.
