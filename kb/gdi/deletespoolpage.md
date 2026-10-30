---
kind: function
module: GDI
name: DeleteSpoolPage
ordinal: 253
summary: Throws away the page a print job is writing -- a job straight to a file goes back to where the page began, nothing cut off -- answering 1.
versions:
  '3.1': partial
probes: [gdispool]
records: [call, file]
source: src/win16/gdi/spooler.ts
topics: [gdi-internals, printing]
---

## Observed behaviour

[[probe:gdispool]] writes pages to a file named as the job's port, deletes some, and reads the file.

- [[measured]] `DeleteSpoolPage(hJob)` answers 1 for a job straight to its file. What the job held in its buffer is let go, and its next bytes are written where the page began. Nothing after is cut off: a file of 256 bytes, with seven bytes written again from its start, keeps all 256.
- [[measured]] Where the page began is where the job had written to when `StartSpoolPage` was last called -- but only while Print Manager has given GDI its window. With no window it is the file's start, whatever pages came before.
- [[measured]] Only bytes the job has written to the file count: bytes still in its buffer when the page started are not where it began.
- [[measured]] -5 to -1 are answered as they are; a closed job, nought and -6 answer -3.

## Inside Windows

[[read out]] `GDI.EXE` seg28 `0ff3`. After the job's checks (`05b1`, then -3 below 148h bytes), a job through the communications driver or the network (80h or 01h of its first word's high byte) answers nought. Otherwise the buffer's count at 0Ah is made nought and the page's block found at 13Ah plus twice the page (`1046`-`1057`); with none, -1. For a job straight to its port (40h), the block's written count at 6 is set to the job's long at 114h, which [[fn:GDI.StartSpoolPage]] keeps, and `_llseek` takes the file there, with the job's PSP current (`1083`-`10b1`). For Print Manager's page the file is closed where it was kept open, its path deleted with `DeletePathName`, the block freed and its place cleared (`10b8`-`10f7`). Then 1.

## Callers

[[read out]] None imports it (`kb/data/gdi-callers.json`).

## Implementation

In both engines as read out (`spooler.ts`, `spooler.rs`); the deleting is as [[fn:GDI.DeleteJob]]'s. [[probe:gdispool]] agrees in both.

**Recommendation:** done.

## Not yet done

- Print Manager's own pages, which WinBox does not make ([[topic:printing]]): the branch that closes and deletes a page's file is followed but not recorded.
