---
kind: function
module: GDI
name: QueryJob
ordinal: 248
summary: What a printer's driver asks of a print job -- whether its handle is a job, or whether Print Manager has disk space for it.
versions:
  '3.1': exact
probes: [gdispool]
records: [query, spooljob]
source: src/win16/gdi/spooler.ts
topics: [gdi-internals, printing]
---

## Observed behaviour

[[probe:gdispool]] asks it of a job [[fn:GDI.OpenJob]] opened, of what is not one, and around [[fn:GDI.GetSpoolJob]]'s 1Bh.

- [[measured]] `QueryJob(hJob, SP_QUERYVALIDJOB)`, 30, answers 1 for a job, and for any handle that, shifted back left a bit, names a block of 148h bytes or more -- a block of the probe's own of that size passes. A smaller block, nought, a closed job and the answers -6 to -1 answer nought.
- [[measured]] `QueryJob(hJob, SP_QUERYDISKAVAIL)`, 1004h, answers 1 while the long Print Manager last gave with `GetSpoolJob`'s 1Bh is not nought, whatever the job, even nought; nought before, after 1Bh with nought, and after 15h takes Print Manager's window away. 10000h is not nought.
- [[measured]] Every other code answers nought, 29 and 31 among them.

## Inside Windows

[[read out]] `GDI.EXE` seg28 `18e4`: for 30, the handle's check (`05b1`, nought for -5 to -1) and `GlobalSize` of the handle shifted left, 1 at 148h or more; for 1004h, the long at `[058Ah]`, which `GetSpoolJob`'s 1Bh sets and its 15h clears with no window (seg28 `1884`, `1859`), and which Print Manager's answer to message 1004h sets as pages are spooled (`061c`, `1268`, `13b1`); else nought. `retf 4`.

## Callers

[[read out]] None imports it (`kb/data/gdi-callers.json`); a third-party printer's driver would.

## Implementation

In both engines as read out (`spooler.ts`, `spooler.rs`); the long is the spooler's `diskSpace`, which `GetSpoolJob` keeps. [[probe:gdispool]] agrees in both.

**Recommendation:** done.
