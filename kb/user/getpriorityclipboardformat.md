---
kind: function
module: USER
name: GetPriorityClipboardFormat
ordinal: 402
summary: The first of a list of formats that is on the clipboard.
versions:
  '3.1': exact
probes: [usermisc]
records: [priority]
topics: [clipboard]
source: crates/winbox-win16/src/small_calls.rs
---

## Observed behaviour

- [[measured]] [[probe:usermisc]]: nought with the clipboard empty; with text on it, the first of a list that is there -- `CF_OEMTEXT`, made from the text, too -- noughts in the list passed over; -1 where none is, or for a count of nought.

## Inside Windows

- [[read out]] `USER.EXE` seg39 `0080`-`00ea`: nought where the clipboard holds no format; else the list read while the count, signed, is above nought, each format not nought looked for among the clipboard's; -1 at the end.

## Implementation

`crates/winbox-win16/src/small_calls.rs`.
