---
kind: function
module: GDI
name: SpoolFile
ordinal: 254
summary: Hands a file to Print Manager to print as a job of a printer's queue, answering the job's handle, or -1 with no queue or no Print Manager.
versions:
  '3.1': exact
probes: [gdispool]
records: [spoolfile, message, freed, printman, spooljob]
source: crates/winbox-win16/src/gdi/spooler.rs
topics: [gdi-internals, printing]
---

## Observed behaviour

[[probe:gdispool]] stands for Print Manager: its window is given to GDI with [[fn:GDI.GetSpoolJob]]'s 15h, and it answers message 1001h. A printer of its own is put in WIN.INI's `[PrinterPorts]`.

- [[measured]] `SpoolFile(lpszPrinter, lpszPort, lpszJob, lpszFile)` with no queue for the port answers -1. A queue is found by the port and the printer, else the first with the port; the port compared without its colon and without regard to case.
- [[measured]] With a queue, Print Manager's window is sent 1001h: the word the job's handle, a block of 148h bytes, and the long the queue's number. The job then holds 1 at nought, page 1, room for 7 pages, the queue, no device context, the file's size at 110h (nought for a file not there), the job's name at 11Ah, and a page's block of C2h bytes at 13Ah.
- [[measured]] An answer of -1 frees the job and answers -1. Any other -- `0777h`, `FFFFh` in the low word alone -- answers the job's handle, as it is, not shifted: `QueryJob` of it shifted right a bit answers 1.
- [[measured]] With the spooler off in WIN.INI and no window from Print Manager it answers -1, and Print Manager is not started.

## Inside Windows

[[read out]] `GDI.EXE` seg28 `156f`. The queues are readied if they are not (`157b`). With no window from Print Manager it is started as [[fn:GDI.OpenJob]] starts it (`1967`), and -1 answered while it has given none. The port's name and the printer's are made atoms and the queue found (`17bb`). Then the job's block, `GlobalAlloc(3042h, 148h)`, and the page's, `GlobalAlloc(42h, C2h)`, -5 where either fails; the job's name copied, no more than 1Fh bytes (`1933`); the file's size, `OpenFile` into the page's structure, `_llseek` to its end and `_lclose` (`1529`). Then `SendMessage` of 1001h to `[058Eh]` (`16dc`-`16fd`). `retf 10h`.

## Callers

[[read out]] It is declared in the SDK's headers (`win16.h`); no file of the installations or the corpus imports it.

## Implementation

As read out (`crates/winbox-win16/src/gdi/spooler.rs`). What Print Manager does with the job is Print Manager's. [[probe:gdispool]] agrees in both.

**Recommendation:** done.
