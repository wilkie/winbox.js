---
kind: function
module: GDI
name: GetSpoolJob
ordinal: 245
summary: GDI's own interface to Print Manager — an option and a parameter over the spooler's queues and jobs.
versions:
  '3.1': exact
probes: [spooljob]
source: src/win16/gdi/GetSpoolJob.ts
---

## Observed behaviour

[[probe:spooljob]] asks as Print Manager asks when it starts — 1Dh, 19h, 14h with a buffer, then 15h with its window — and then every option that only reads. The installation has no printer. winbox.js agrees with all 18 records.

- [[measured]] 19h readies the spooler's queues and answers how many there are, and 1Dh answers the same count: nought here, before and after.
- [[measured]] 14h fills the buffer it is given with a job's details: 42 bytes, all nought with no printer. It answers nought.
- [[measured]] 15h takes Print Manager's window and answers nought, the count of jobs. 22h answers 1 before that and nought after, and 1 again once 15h is given nought.
- [[measured]] 20h and 21h, the timeouts of queue nought, answer nought, as do the options outside 14h–23h.

## Nuances

- [[read out]] The options, from `GDI.EXE` seg28 `1802`: 14h fills the next job's details; 15h keeps the window, forgetting the procedure 1Bh kept when given nought; 19h readies the queues from the printers the first time only, 1Ch again, and 1Fh lets 19h ready them afresh; 20h and 21h read a queue's two timeouts, which GDI takes from `[PrinterPorts]`; 23h sets or clears a flag. The rest answer nought.

## Not yet done

Printers, their queues and their jobs. winbox.js has no printer, so its spooler is always empty.
