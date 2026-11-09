---
kind: function
module: USER
name: Bear11
ordinal: 11
summary: SetTimer for a system timer: one that comes as WM_SYSTIMER and that KillTimer does not stop.
versions:
  '3.1': exact
probes: [systimer]
source: crates/winbox-win16/src/queue.rs
topics: [user-internals]
---

## Observed behaviour

- [[measured]] [[probe:systimer]]: it answers the identifier, and 1 for nought; the window's system timer comes as `WM_SYSTIMER` (118h) with the identifier in `wParam` and nought in `lParam`, beside a `WM_TIMER` timer of the same window and identifier that `SetTimer` set; `KillTimer` of that identifier answers 1 and the system timer still comes; a procedure given comes in `lParam`, and `DispatchMessage` calls it with 118h for the message; with no window it answers non-nought, and [[fn:USER.Bear182]] of that answer stops it.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `744c`: `mov cx,1` and into `SetTimer`'s body at `744f`, which `SetTimer` (`7448`) enters with CX nought. CX is kept in the timer's entry at 0Ah (`74ce`-`74d0`), and an entry is found by its window, its identifier and that flag (`759c`-`75c3`). A system timer may take the 33rd and 34th entries, which `SetTimer` may not (`748f`-`749d`). With no window, the identifier is the entry's address (`74a7`-`74ab`).
- [[read out]] A due system timer is made `WM_SYSTIMER` (`73f3`-`73fc`); `DispatchMessage` calls the procedure in `lParam` for `WM_TIMER` and `WM_SYSTIMER` alike, with the message as it is (seg1 `274e`-`2769`).
- [[read out]] USER's own system timers: the caret's blink, a scroll bar's repeat, the task list's look for the screen saver.

## Callers

- No file of the installations or the corpus imports it (`kb/data/user-callers.json`).

## Implementation

`src/win16/user/SetTimer.ts` over `queue.ts`; the Rust engine's `queue.rs` (`set_timer_as`). A timer's key is its window, identifier and message, so a system timer and a timer of one identifier are two; USER's own system timers -- the caret's, the scroll bars', the screen saver's -- are set the same way. A timer of no window and identifier nought is kept as 1, the identifier answered. WinBox's identifiers for a timer of no window are not entry addresses.
