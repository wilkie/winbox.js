---
kind: function
module: MMSYSTEM
name: mciGetDeviceIDFromElementID
ordinal: 715
summary: The MCI device opened with an element ID, of a type.
versions:
  '3.1': partial
probes: [mmmisc]
records: [mci]
source: crates/winbox-win16/src/mmsystem/mci.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]]: nought for an ID no device was opened with, and nought for no type.

## Nuances

- Opening a device by an element ID is not followed further: the ID is kept, but the open goes on as an element's name would.

## Inside Windows

- [[read out]] seg5 `1454`: each device opened with `MCI_OPEN_ELEMENT_ID` and that ID, whose type -- MMSYSTEM's string of its `wType`, loaded into 50h bytes -- `lstrcmpi` finds the same as the one asked.

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/mci.rs`.
