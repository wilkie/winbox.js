---
kind: topic
name: Printing
summary: What GDI does around any printer when a program prints a document — which calls succeed, what the calls out of order answer, when the abort procedure runs — recorded with Windows' own PostScript driver; and winbox.js's own printer, which hands documents on as PDFs.
probes: [printing]
---

A program prints by asking WIN.INI for the default printer, making a device context for it with [fn:GDI.CreateDC], and drawing a document into it a page at a time. What the pages turn into is the driver's business. What GDI does around them is the same for any printer, and that is what winbox.js is held to.

## What was recorded

[[measured]] [[probe:printing]] runs on an installation of its own, `vgaprint`: the VGA, with an Apple LaserWriter Plus, Windows' PostScript driver, installed by Setup's own answer file. It turns Print Manager's spooler off and sends the printer's output to a file named as its port, so nothing waits on a printer. winbox.js agrees with all 24 records.

- WIN.INI's `[windows]` `device` names the default printer as its device, its driver and its port. Setup writes it there, with the printer under `[devices]` and `[PrinterPorts]` too.
- `CreateDC` of the driver, the device and a file as the port gives a device context.
- Every call of a document printed succeeds: [[fn:GDI.StartDoc]], [[fn:GDI.StartPage]], [[fn:GDI.EndPage]] and [[fn:GDI.EndDoc]], and the escapes that came before them, `STARTDOC`, `NEWFRAME` and `ENDDOC`. Each document writes the file.
- **Out of order.** Before `StartDoc`, `StartPage` answers 1, `EndPage` -1 and `EndDoc` 1. After [[fn:GDI.AbortDoc]], `EndPage` answers -1 and `EndDoc` 1.
- **The abort procedure.** [[fn:GDI.SetAbortProc]] answers a number of the driver's, 1431 for this one, above nought. GDI calls the procedure as the driver's output is written, each time with the printer's device context and nought. How often is the driver's: 43 times for the PostScript driver's `StartDoc` alone, as it writes its prolog.

## winbox.js's printer

winbox.js has no Windows printer driver to run, and brings its own: a driver called `WBPRINT`, the device "WinBox Printer" (`src/win16/printer.ts`). It draws a page as a bitmap of US Letter at 300 dots an inch in the sixteen colours, with GDI's own drawing. [[fn:GDI.GetDeviceCaps]] answers its sizes for its device context. At the end of a document it hands the pages on as a PDF: into the file its port names, or, for a port that is a device such as `LPT1:`, to the page the emulator runs in (`onPrinted`). It calls the abort procedure as it writes each page and the document. It is installed as Setup installs a printer, by its entries in WIN.INI (`installPrinter`).

Not yet done: Print Manager and the spooler, the printer's dialogs (`ExtDeviceMode`), fonts of the printer's own, and bands (`NEXTBAND`).
