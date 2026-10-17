---
kind: topic
name: Printing
summary: What GDI does around any printer when a program prints a document — which calls succeed, what the calls out of order answer, when the abort procedure runs — recorded with Windows' own PostScript driver; and winbox.js's own printer, which hands documents on as PDFs.
probes: [printing, prdoc, prabort, prnote]
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

A Windows printer driver on the drive, such as the PostScript driver, is loaded and run as Windows' GDI runs it ([[topic:printer-drivers]]). For a machine with none, winbox.js brings its own: a driver called `WBPRINT`, the device "WinBox Printer" (`src/win16/printer.ts`). It draws a page as a bitmap of US Letter at 300 dots an inch in the sixteen colours, with GDI's own drawing. [[fn:GDI.GetDeviceCaps]] answers its sizes for its device context. At the end of a document it hands the pages on as a PDF: into the file its port names, or, for a port that is a device such as `LPT1:`, to the page the emulator runs in (`onPrinted`). It calls the abort procedure as it writes each page and the document. It is installed as Setup installs a printer, by its entries in WIN.INI (`installPrinter`).

## Windows' printer drivers

[[read out]] Of a document on a Windows driver's DC, GDI does little itself (`GDI.EXE` seg31): `StartDoc` gives the driver's `Control` `SETABORTPROC` with the DC, then `STARTDOC` with the document's name, and the `DOCINFO` as its output where the driver's `GDIINFO` is newer than 300h; `StartPage` only marks the DC and answers 1; `EndPage` answers -1 on a DC not so marked, else the escape `NEWFRAME`'s answer; `EndDoc` is `Control`'s `ENDDOC`; `AbortDoc` the escape `ABORTDOC`; `SetAbortProc` the escape `SETABORTPROC`. The driver writes its output through GDI's spooler, which writes it to the port's file or device ([[fn:GDI.OpenJob]], [[fn:GDI.WriteSpool]]).

[[measured]] [[probe:prdoc]] prints a page of text, a rectangle, a line and an ellipse through the PostScript driver to a file, and records every line of PostScript it wrote. Its `EndPage` answers the driver's job. [[probe:prabort]] covers the documents that do not go as planned. [[probe:prnote]] has Notepad print a note with `/p` through the driver. winbox.js runs the driver's code for all of it, drawing through the driver as GDI does, and both engines agree with every record ([[topic:printer-drivers]]).

## Not yet done

- Print Manager, and the spooler's jobs through it.
- What a Windows driver's DC leaves to GDI's own drawing; see [[topic:printer-drivers]].
- WinBox's own printer's dialogs (`ExtDeviceMode`), fonts of the printer's own, and bands (`NEXTBAND`).
