---
kind: function
module: GDI
name: OpenJob
ordinal: 240
summary: Opens a print job for a printer driver's output — straight to a file or port, through the communications driver, or to Print Manager — and answers its handle, broadcasting that it opened.
versions:
  '3.1': partial
probes: [prspool, prlpt, prdoc]
source: src/win16/gdi/spooler.ts
topics: [printer-drivers, printing]
---

## Observed behaviour

[[measured]] [[probe:prspool]] calls the spooler as a printer driver calls it, finding each function in GDI by its number. Each job goes to a file named as its port. Both engines agree with all 33 records.

- No port, or an empty one, answers -1.
- A job to a file answers a handle. Shifted back left, the handle names a block of 352 bytes. The file is made empty at once, before anything is written.
- Every top-level window is sent message 40h with 2, and with 1 in the low word of the long and the job's handle in the high.

[[measured]] [[probe:prlpt]] opens a job to `LPT1`, a port of `[PrinterPorts]`, with Print Manager's spooler off. That also answers a block of 352 bytes, and the job goes through the communications driver ([[fn:GDI.WriteSpool]]). [[probe:prdoc]]'s `EndPage` answers the PostScript driver's job, the same 352 bytes.

## Inside Windows

[[read out]] `GDI.EXE` seg28 `01c3`. The job is `GlobalAlloc(3042h, 148h)`. Its handle is answered shifted right a bit (`0576`), and every other spooler call takes it back and refuses a block smaller than 148h with -3. The job keeps how it prints in its first word's high byte: 40h straight to its port, 20h through Print Manager, 80h through the communications driver, 01h through the network. Its 100h-byte buffer is at 10h, and the port's name at 11Ah.

- **WIN.INI**, read as the first job opens (seg29 `00d7`): `[windows]` `spooler`, `DosPrint` and `NetSpool`, and every port of every printer in `[PrinterPorts]` with its two timeouts. A port's name is taken to a comma or a space, without a colon at its end (seg29 `044d`).
- **A port of `[PrinterPorts]` that is not `FILE`** is asked of the network first, through `WNetOpenJob`. With no network that answers that it has none. Then, with the spooler on, the job goes to Print Manager, which is started where it is not running (seg28 `1967`: `PrintMan` from Windows' directory, minimized).
- **Otherwise**, where `DosPrint` is not `yes`, a port the communications driver opens goes through it (seg30 `00ea`). It is opened with `OpenComm(port, 10h, 400h)`, or 30h for the second queue where 400h is refused with -4. Its state is read, then set again from WIN.INI's `[ports]` where that names the port's settings (seg30 `01a9`): baud, parity, bits, stop bits, and XON/XOFF for a fifth field.
- **Any other job** is straight to its port. A file is made empty with `OpenFile(OF_CREATE)` and closed. For `FILE`, USER's "Print To File" box asks for the name (`GetFilePortName`, `[0A54h]`).
- Each job opened is broadcast: `SendMessage(HWND_BROADCAST, 40h, 2, MAKELONG(1, job))`.

## Implementation

`src/win16/gdi/spooler.ts` and `crates/winbox-win16/src/gdi/spooler.rs`, called by a driver through GDI's exports.

## Not yet done

- Print Manager's side of a job: a port of `[PrinterPorts]` with the spooler on, once Print Manager has its window.
- The network's jobs. `WNetOpenJob` answers that there is no network.
- `FILE`'s "Print To File" box. It is refused as a box cancelled.
- DOS's devices for a `DosPrint` job, and the PSP GDI makes current around each file call.
