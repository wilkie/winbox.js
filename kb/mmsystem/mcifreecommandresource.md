---
kind: function
module: MMSYSTEM
name: mciFreeCommandResource
ordinal: 713
summary: Lets an MCI command table go, unless a device uses it.
versions:
  '3.1': exact
probes: [mmcmd]
records: [free, close]
source: crates/winbox-win16/src/mmsystem/mci_tables.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmcmd]]: table nought, and a number at or past the end, answer nought; so do the tables an open device uses, its type's and its driver's. A table freed answers 1 -- and again 1 freed a second time, the place being free either way. Closing the device frees its type's table, and MCIWAVE frees its own as it is freed; both are gone after.

## Inside Windows

- [[read out]] seg5 `2fb9`: nought or past the end refused; each device's type table (+20h) and custom table (+22h) compared; the resource freed, the index freed, the table's library freed; the end drawn in by one if it was the last. Closing a device zeroes both its tables and frees its type's before its driver is closed (seg5 `298c`).

## Implementation

Both engines, as read out: `src/win16/mmsystem/mci-tables.ts` and `crates/winbox-win16/src/mmsystem/mci_tables.rs`. WinBox's own MMSYSTEM and MCIWAVE have no resources: their tables are known by name, as their files have them, and their contents are not kept, since `mciSendString` here reads no table.
