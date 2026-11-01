---
kind: function
module: GDI
name: CreateDC
ordinal: 53
summary: Makes a device context for a device by its driver's name: the screen for DISPLAY, WinBox's own printer for WBPRINT, and any other printer driver loaded from the drive and enabled as Windows' GDI enables it.
versions:
  '3.1': partial
probes: [pric, prdlg, printing, prttstk]
source: src/win16/gdi/CreateDC.ts
topics: [printer-drivers]
---

## Observed behaviour

- [[measured]] `CreateDC` of the PostScript driver, `pscript`, with the Apple LaserWriter Plus and a file as its port gave a device context ([[probe:printing]]), and COMMDLG's `PD_RETURNDC` handed one back ([[probe:prdlg]]).
- [[measured]] `DISPLAY` gives a context over the whole screen, as `GetDC(NULL)` does.

## Nuances

- [[read out]] A DC on WIN.INI's `NullPort` is refused; an IC is not ([[topic:printer-drivers]]).
- [[read out]] The driver's name has `.drv` added before `LoadLibrary` (seg1 `02a7`-`02d2`). [[measured]] [[probe:prttstk]]: a name given with `.DRV` already, `MGXWMF.DRV`, is found where its module, `MGXWMF`, is loaded; `KERNEL` answers `MGXWMF.DRV.drv` with it.
- [[read out]] A context of a driver named `MGXWMF.DRV`, without case, is flagged 40h at 0Bh: GDI adds the name to its own atoms as it starts and compares the atom of the driver's name with it (seg1 `0242`-`024f`, seg2 `024e`-`0259`). [[fn:GDI.EngineExtTextOut]] gives such a context its widths as for a turned font ([[probe:prttstk]]).
- [[read out]] A second context on a device the driver has enabled shares its `PDEVICE`, as `dpDCManage` lets; the PostScript driver's is 1, a device for every context.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `480a`, into seg1 `0078` with a flag of nought: the driver found or loaded and its ordinals 1 to 30 kept, the device found or enabled with `Enable` twice — for the `GDIINFO`, then for the `PDEVICE` of `GlobalAlloc(2002h, dpDEVICEsize)` — and the context made. See [[topic:printer-drivers]].

## Implementation

`src/win16/gdi/printer-driver.ts` and `crates/winbox-win16/src/gdi/printer_driver.rs` run the driver's code on the processor; `DISPLAY` and `WBPRINT` are kept by winbox.js ([[topic:printing]]). Not followed: banding drivers, and drawing through the driver.
