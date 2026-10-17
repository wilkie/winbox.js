---
kind: function
module: COMMDLG
name: FontFamilyEnumProc
ordinal: 19
summary: The Font dialog's face enumeration procedure — given to GDI's EnumFontFamilies with no face name, it leaves out the faces the flags refuse, marks each the screen's or the printer's, and keeps one row a face in the faces' list, the best kind winning.
versions:
  '3.1': stub
probes: [chfont]
topics: [common-dialogs, choose-font, font-enumeration]
---

## Observed behaviour

No program calls it. The Font dialog gives its far address to [[fn:GDI.EnumFontFamilies]], found by ordinal with `GetProcAddress`, with no face name, once for the screen and, with `CF_PRINTERFONTS`, once for the structure's `hDC`. GDI calls it for each face with the face's `LOGFONT`, its `TEXTMETRIC`, its font type and the dialog's data; it answers 1 to go on and nought to stop.

- [[read out]] The data (`COMMDLG.DLL` seg4 `126a`): the faces' combo box at 0, the `CHOOSEFONT`'s `Flags` at 8, and at 10h whether the printer is being enumerated.
- [[read out]] A face is left out, answering 1 (`10a3` to `10fd`): with `CF_TTONLY` one that is not `TRUETYPE_FONTTYPE`; with `CF_SCALABLEONLY` one that is `RASTER_FONTTYPE`; with `CF_ANSIONLY` one whose `lfCharSet` is not nought; with `CF_FIXEDPITCHONLY` one whose `lfPitchAndFamily` has `VARIABLE_PITCH`; with `CF_NOVECTORFONTS` one whose `lfCharSet` is `OEM_CHARSET`, 255.
- [[read out]] The type is given `PRINTER_FONTTYPE` from the printer, else `SCREEN_FONTTYPE` (`10ff`).
- [[read out]] A face not yet listed is added with `CB_ADDSTRING`, its data the type; a list that will not take it answers nought, ending the enumeration (`11e2`).
- [[read out]] A face listed already is replaced -- inserted again at its index and the old row deleted -- where the new ranks above the old by `1079`'s comparison: each type with its screen and printer bits cleared and its raster bit flipped, so TrueType, device, vector, raster from best to worst; and, with `CF_PRINTERFONTS` but not `CF_SCREENFONTS`, wherever a printer's face meets the screen's (`1145`). The row's data keeps the screen and printer bits of both (`11ba`).
- [[measured]] [[probe:chfont]] records the faces and their types for six sets of flags: TrueType faces 2004h, raster 2001h, vector 2000h; from an information context on the display enumerated as the printer, 6004h and 6000h. Both engines agree.

## Nuances

- [[read out]] `CF_NOVECTORFONTS` is a test of the character set, not the type. [[inferred]] Any face of `OEM_CHARSET` goes with it, Terminal among them; [[probe:chfont]] asks for it only beside `CF_SCALABLEONLY`, which leaves Terminal out already.
- [[read out]] Faces the flags keep out after enumerating -- only the screen's without `CF_SCREENFONTS`, not both with `CF_WYSIWYG` -- are deleted by the dialog afterwards, not here ([[topic:choose-font]]).

## Inside Windows

[[read out]] `COMMDLG.DLL` seg4 `1096`, `retf 0Eh`: the `LOGFONT` far pointer at `[bp+10h]`, the `TEXTMETRIC` at `[bp+0Ch]`, the type at `[bp+0Ah]` and the data at `[bp+6]`. The dialog passes its address straight from the entry table, with no `MakeProcInstance`: the exported prologue loads COMMDLG's data segment.

## Implementation

Not WinBox's own yet: ordinal 19 is a stub in `src/win16/commdlg/index.ts` (popping 14 bytes) with no arm in `crates/winbox-win16/src/commdlg/mod.rs`. With `COMMDLG.DLL` on the drive the file's code runs it, through the engines' `EnumFontFamilies`.
