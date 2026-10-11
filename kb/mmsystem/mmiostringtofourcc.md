---
kind: function
module: MMSYSTEM
name: mmioStringToFOURCC
ordinal: 1220
summary: Makes four characters a four-character code.
versions:
  '3.1': exact
probes: [mmio]
source: src/win16/mmsystem/mmio.ts
topics: [multimedia-files]
---

## Observed behaviour

- [[measured]] A nought is a space and the reading goes on past it: `ab`, nought, `cd` is `ab c`.
- [[measured]] `MMIO_TOUPPER` makes the bytes capital; another flag answers FFFFFFFFh.
- The rest, with what MMSYSTEM does inside, is [[topic:multimedia-files]].

## Implementation

As read out of `MMSYSTEM.DLL` seg7, the same in both engines: `src/win16/mmsystem/mmio.ts` and `crates/winbox-win16/src/mmsystem/mmio.rs`.
