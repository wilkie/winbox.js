---
kind: function
module: MMSYSTEM
name: mciGetYieldProc
ordinal: 716
summary: The procedure an MCI device's driver calls while it waits, and its doubleword.
versions:
  '3.1': exact
probes: [mmmisc]
records: [mci]
source: crates/winbox-win16/src/mmsystem/mci.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]]: a device just opened has MMSYSTEM's own procedure, code of its own, with 3 -- `VK_CANCEL` -- and no window; after `MCI_BREAK` with a key and a window, the key in the low word and the window in the high; with no window, nought there. An ID not open answers nought, its doubleword untouched.

## Nuances

- MMSYSTEM's own procedure has no export. Both engines keep it at an ordinal of MMSYSTEM's where Windows exports nothing (1202), as they keep its I/O procedures (`mmio.ts`).

## Inside Windows

- [[read out]] seg5 `2b3c`: the device checked; a pointer given is checked with `IsBadHugeWritePtr` for four bytes and the doubleword written there; the answer is the procedure.

## Implementation

Both engines, as read out: `src/win16/mmsystem/mci.ts` and `crates/winbox-win16/src/mmsystem/mci.rs`.
