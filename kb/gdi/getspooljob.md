---
kind: function
module: GDI
name: GetSpoolJob
ordinal: 245
summary: GDI's own interface to Print Manager — an option and a parameter over the spooler's queues and jobs.
versions:
  '3.1': exact
probes: [spooljob, gdispool]
source: crates/winbox-win16/src/gdi/spool_job.rs
---

## Observed behaviour

[[probe:spooljob]] asks as Print Manager asks when it starts — 1Dh, 19h, 14h with a buffer, then 15h with its window — and then every option that only reads. The installation has no printer. winbox.js agrees with all 18 records.

- [[measured]] 19h readies the spooler's queues and answers how many there are, and 1Dh answers the same count: nought here, before and after.
- [[measured]] 14h fills the buffer it is given with a job's details: 42 bytes, all nought with no printer. It answers nought.
- [[measured]] 15h takes Print Manager's window and answers nought, the count of jobs. 22h answers 1 before that and nought after, and 1 again once 15h is given nought.
- [[measured]] 20h and 21h, the timeouts of queue nought, answer nought, as do the options outside 14h–23h.

[[probe:gdispool]] stands for Print Manager on the same installation and puts a printer of its own in `[PrinterPorts]`, `PSCRIPT,LPT1:,15,45`.

- [[measured]] 19h answers nought where the first job readied the queues before the printer was put there; after 1Fh it reads `[PrinterPorts]` again and answers 1, the printer's queue, and so does 1Dh.
- [[measured]] 20h answers 45000 and 21h 15000 for that queue: the second number after the port and the first, made milliseconds.
- [[measured]] 1Bh answers nought and keeps its long, which [[fn:GDI.QueryJob]]'s 1004h asks after; 15h with nought forgets it.

## Nuances

- [[read out]] The options, from `GDI.EXE` seg28 `1802`, a table at `1821`: 14h fills the next job's details; 15h keeps the window (`[058Eh]`), forgetting the disk space 1Bh kept when given nought, and answers the count of jobs (`[0592h]`); 19h readies the queues from the printers where they are not readied (`[0590h]`), as the first job does, and answers their count (`[0A28h]`); 1Ch reads them again and answers nought; 1Fh lets 19h ready them afresh; 1Bh keeps a long, Print Manager's disk space (`[058Ah]`), not a procedure; 20h and 21h read a queue's two timeouts, by its number; 22h answers whether no window is given; 23h sets or clears flag 8 of `[064Ah]`. The rest answer nought.
- [[read out]] A queue is 0Ch bytes from `[0934h]` (seg29 `0000`): the port's and the device's atoms, then the second number after the port at +4 and the first at +8, each read as digits from its first character (seg30 `0310`) and made milliseconds. A number not there leaves 2AEA540h and E4E1C0h, 45 and 15 seconds made milliseconds twice.

## Not yet done

Print Manager's jobs, which 14h would describe; WinBox makes none. A queue's timeouts asked by a number past the queues, which GDI reads from what its table last held there; WinBox answers nought.
