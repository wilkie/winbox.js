---
kind: function
module: USER
name: GetDesktopHWnd
ordinal: 278
summary: The desktop window's handle: GetDesktopWindow under another name.
versions:
  '3.1': exact
probes: [usermisc]
records: [desktop]
topics: [small-queries]
source: src/win16/user/GetDesktopWindow.ts
---

## Observed behaviour

- [[measured]] [[probe:usermisc]]: the handle [[fn:USER.GetDesktopWindow]] answers.

## Inside Windows

- [[read out]] `USER.EXE` exports both at seg1 `19ca`: `[0F0h]`, the desktop window.

## Implementation

The same function as `GetDesktopWindow` in both engines' tables.
