---
kind: function
module: MMSYSTEM
name: mciLoadCommandResource
ordinal: 705
summary: Loads an MCI command table from a module's RCDATA resource, and numbers it.
versions:
  '3.1': exact
probes: [mmcmd]
records: [load, open]
source: crates/winbox-win16/src/mmsystem/mci_tables.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmcmd]], from the probe's own resources: the first table a program loads is 1 -- MMSYSTEM's core table, loaded first, is nought. A resource with no command in it, or none of that name, answers FFFFh. Loading the same resource again gives another number; a number freed is given again.
- [[measured]] Opening a waveaudio device loads MCIWAVE's own table and, unless a table of type 20Ah is loaded already, MMSYSTEM's waveaudio table: with the probe's own table loaded with type 20Ah, the device took that one as its type's.

## Inside Windows

- [[read out]] seg5 `2d4c`: the core table loaded first, once; the resource looked for in `NAME.MCI` (its first eight characters) if `OpenFile` finds it, else in the module given; loaded and locked, its commands counted (heads, type 0, to the end, type 6); an index of them made; the table put in the first free of twenty places (seg5 `2cee`).
- [[read out]] A device's type table is the first table loaded with its type, else MMSYSTEM's resource named by its type's string (seg5 `2f4c`): `waveaudio`, `sequencer` and the rest.

## Implementation

Both engines, as read out: `src/win16/mmsystem/mci-tables.ts` and `crates/winbox-win16/src/mmsystem/mci_tables.rs`. WinBox's own MMSYSTEM and MCIWAVE have no resources: their tables are known by name, as their files have them, and their contents are not kept, since `mciSendString` here reads no table.
