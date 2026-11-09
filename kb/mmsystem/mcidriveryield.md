---
kind: function
module: MMSYSTEM
name: mciDriverYield
ordinal: 710
summary: What an MCI driver calls while it waits: the device's yield procedure, or Yield.
versions:
  '3.1': exact
probes: [mmmisc]
records: [mci, yieldproc]
source: crates/winbox-win16/src/mmsystem/mci.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]]: with the probe's procedure set, it is called with the device's ID and its doubleword, and its answer, 55h, is the answer. MMSYSTEM's own, with its key not pressed, answers nought; so does an ID not open.

## Inside Windows

- [[read out]] seg5 `2a6f`: a device with a procedure has it called; else KERNEL's `Yield`, and nought.
- [[read out]] MMSYSTEM's own (seg5 `2bbf`): with a window in its doubleword's high word that is not the active one, or its key not pressed since last asked (`GetAsyncKeyState`), `Yield` and nought; else the window's keyboard messages taken from its queue and FFFFh, which breaks the wait. A command sent with `MCI_WAIT` while it is the procedure first forgets the key's press (seg5 `1b1`).

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/mci.rs`.
