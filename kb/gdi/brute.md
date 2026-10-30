---
kind: function
module: GDI
name: Brute
ordinal: 213
summary: The dispatcher behind GDI's DM helpers -- it calls the display driver's routine on a memory bitmap a printer's driver was handed -- taking its routine in CX, not a function a program can call.
versions:
  '3.1': stub
probes: [gdidm]
records: [notbitmap]
topics: [gdi-internals, printer-drivers]
---

## Observed behaviour

- [[measured]] Through the helpers that jump to it ([[probe:gdidm]]): for a device whose first word is not nought, or one marked `DI`, the answer's high word is the routine's offset in a driver's table -- 4 for `DMColorInfo`, 20h for `DMPixel`.

## Inside Windows

[[read out]] `GDI.EXE` seg13 `0171`, reached by a jump with CX set: CL the words on the stack to move, the arguments and the return address and two of its own, and CH the routine's offset in a driver's table.

1. It copies those words 20h bytes lower on the stack and makes a frame above them (`0174`-`019f`), so that the routine it calls takes the arguments off the copy and its own `retf` leaves the caller's arguments gone too (`0204`-`0211`).
2. It looks at the first argument, the device (`01a5`, `0212`). A device whose first word is nought is a memory bitmap: its `bmlpPDevice` at 12h is saved and set to the display's device, offset nought and the segment the display's device structure keeps at 10h (`0232`-`0246`); GDI's handle at `[0012h]` names that structure. A device marked `DI` (4944h) takes its table from `[0159h]` (`0226`). Any other device leaves at once (`0224`), AX GDI's data segment and DX the offset.
3. For offset nought, `BitBlt`, the source device is looked at the same way (`01b2`-`01c0`).
4. It calls the display driver's routine: the word at 1Ch of the display's structure is its table, and the offset picks the entry (`01c3`-`01ca`). Then it puts each bitmap's `bmlpPDevice` back (`01ce`-`01fe`).

## Callers

[[read out]] None imports it by ordinal; the helpers at seg13 `012a`-`016e` jump to it.

## Implementation

Its work is done by each helper's own export in both engines (`driver-helpers.ts`, `brute`); the export itself is a stub.

**Recommendation: not needed as an export.** It takes its routine in a register, and nothing outside GDI reaches it. See [[topic:gdi-internals]].

## Not yet done

- What sets `[0159h]`, the `DI` device's table: no code of GDI's was found to.
