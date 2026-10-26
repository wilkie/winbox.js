---
kind: function
module: USER
name: PaintRect
ordinal: 325
summary: A rectangle filled with a brush, or with the brush a control's parent answers for a type.
versions:
  '3.1': exact
probes: [usermisc]
records: [brush]
topics: [standard-controls]
source: src/win16/user/small-calls.ts
---

## Observed behaviour

- [[measured]] [[probe:usermisc]]: a type under 8 asks the parent with `WM_CTLCOLOR` and fills with its answer; a brush fills with itself; with no parent the desktop is asked, and its white answered.

## Inside Windows

- [[read out]] `USER.EXE` seg1 `76eb`-`7763`: the parent, the desktop for none; a brush under 8 taken for a `WM_CTLCOLOR` type (`028c`); the brush's origin set to the parent's client area's corner on the screen, the brush unrealized, the rectangle filled, the origin put back.

## Implementation

`src/win16/user/small-calls.ts`; the Rust engine's `crates/winbox-win16/src/small_calls.rs`.
