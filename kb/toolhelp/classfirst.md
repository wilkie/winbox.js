---
kind: function
module: TOOLHELP
name: ClassFirst
ordinal: 69
summary: The first class in USER's list, filled into a CLASSENTRY.
versions:
  '3.1': exact
probes: [thtask]
records: [class]
source: crates/winbox-win16/src/toolhelp/classes.rs
topics: [tool-helper]
---

## Observed behaviour

- [[read out]] `TOOLHELP.DLL` seg1 `28b0`: the head of USER's class list, from `UserSeeUserDo` 5. Each class gives its module (class 14h), its name and the next class (`296a`-`29c1`).
- [[measured]] [[probe:thtask]]: the newest first, USER's own last. MMSYSTEM's `#42`, which WinBox registers with no instance, is listed with none.

## Implementation

`crates/winbox-win16/src/toolhelp/`. See [[topic:tool-helper]].
