---
kind: function
module: GDI
name: WriteSpool
ordinal: 241
summary: Adds a printer driver's bytes to a print job, writing the job's buffer each time it fills and asking the abort procedure before each write; through the communications driver, a port that does not answer puts up GDI's box.
versions:
  '3.1': partial
probes: [prspool, prlpt, prabort]
source: src/win16/gdi/spooler.ts
topics: [printer-drivers, printing]
---

## Observed behaviour

[[measured]] [[probe:prspool]]: writes of 7 and 300 bytes answer their counts. The file holds them once the job is closed: 314 bytes after a third write of 7. A job that is closed answers -3. A job handle from -5 to -1 is answered back as it is. A job deleted leaves no file.

[[measured]] [[probe:prlpt]]: a write to `LPT1`, where no printer answers, puts up GDI's box, system-modal. Its title is the port, and it has `&Retry` and `Cancel` buttons and the text "The printer on this port is offline or not selected. Make sure the printer is online and selected, …". Cancel answers -3. Both engines agree with all 10 records.

[[measured]] [[probe:prabort]] counts the abort procedure's calls. The PostScript driver's `STARTDOC` alone asks it 43 times, once for each 100h bytes of its prolog written. An abort procedure that answers nought stops the document: `StartDoc` answers -1 and no file is left.

## Inside Windows

[[read out]] `GDI.EXE` seg28 `08eb`. A job with no page answers -1. A job straight to its port keeps the bytes in its 100h-byte buffer, and writes the buffer each time it fills (`0c99`, `0d63`).

- **Each write** (`0a60`) first asks the abort procedure through [[fn:GDI.QueryAbort]]; nought from it answers -2. The bytes are then written with `_lwrite` to the job's file, which is opened again from its `OFSTRUCT` where it is not kept open (`0b9a`).
- **A write that fails** to a file puts up the box that the disk may be full (GDI's string 68h). To a device, the box comes up once `TransmissionRetryTimeout` has passed since the first failure. Retry tries again; Cancel answers -3.
- **Through the communications driver** (seg30 `0000`), the bytes go to `WriteComm`. With none or only some written, the error `GetCommError` gives is kept, and a queue with bytes in it is flushed. Out of paper fails at once, as do 400h, 200h and 10h. Not selected (800h) and timed out (100h) fail once `DeviceNotSelectedTimeout` or `TransmissionRetryTimeout` has passed since the first failure; until then nothing is written and GDI goes round its loop. A failure answers with 8000h added. The box (seg28 `002c`) is GDI's message for the error: out of paper, not responding, not selected, or the port's settings (strings 64h to 68h). Its title is the job's name, with Retry and Cancel, system-modal (`MessageBox` style 1035h).

## Implementation

`src/win16/gdi/spooler.ts` and `crates/winbox-win16/src/gdi/spooler.rs`. GDI waits in its own loop for the timeouts, with nothing else running. On a virtual clock, the time that takes is charged to the clock as instructions run, so the box comes up after the same virtual time in both engines.

## Not yet done

- Print Manager's job and the network's, which answer -1.
- DOS's devices. This DOS has none, only files.
