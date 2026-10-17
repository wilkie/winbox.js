---
kind: function
module: COMMDLG
name: FontFamilyEnumProc
ordinal: 19
summary: The Font dialog's face enumeration procedure — given to GDI's EnumFontFamilies with no face name, it leaves out the faces the flags refuse, marks each the screen's or the printer's, and keeps one row a face in the faces' list, the best kind winning.
versions:
  '3.1': exact
probes: [chfont, chfont2]
topics: [common-dialogs, choose-font, font-enumeration]
source: src/win16/commdlg/choose-font.ts
---

## Observed behaviour

No program calls it. The Font dialog gives its far address to [[fn:GDI.EnumFontFamilies]], found by ordinal with `GetProcAddress`, with no face name, once for the screen and, with `CF_PRINTERFONTS`, once for the structure's `hDC`. GDI calls it for each face with the face's `LOGFONT`, its `TEXTMETRIC`, its font type and the dialog's data; it answers 1 to go on and nought to stop.

- [[read out]] The data (`COMMDLG.DLL` seg4 `126a`): the faces' combo box at 0, the `CHOOSEFONT`'s `Flags` at 8, and at 10h whether the printer is being enumerated.
- [[read out]] A face is left out, answering 1 (`10a3` to `10fd`): with `CF_TTONLY` one that is not `TRUETYPE_FONTTYPE`; with `CF_SCALABLEONLY` one that is `RASTER_FONTTYPE`; with `CF_ANSIONLY` one whose `lfCharSet` is not nought; with `CF_FIXEDPITCHONLY` one whose `lfPitchAndFamily` has `VARIABLE_PITCH`; with `CF_NOVECTORFONTS` one whose `lfCharSet` is `OEM_CHARSET`, 255.
- [[read out]] The type is given `PRINTER_FONTTYPE` from the printer, else `SCREEN_FONTTYPE` (`10ff`).
- [[read out]] A face not yet listed is added with `CB_ADDSTRING`, its data the type; a list that will not take it answers nought, ending the enumeration (`11e2`).
- [[read out]] A face listed already is replaced -- inserted again at its index and the old row deleted -- where the new ranks above the old by `1079`'s comparison: each type with its screen and printer bits cleared and its raster bit flipped, so TrueType, device, vector, raster from best to worst; and, with `CF_PRINTERFONTS` but not `CF_SCREENFONTS`, wherever a printer's face meets the screen's (`1145`). The row's data keeps the screen and printer bits of both (`11ba`) -- but where the printer's face met the screen's the old type is made nought first (`1163`), so that row keeps the printer's bit alone.
- [[measured]] [[probe:chfont]] records the faces and their types for six sets of flags: TrueType faces 2004h, raster 2001h, vector 2000h; from an information context on the display enumerated as the printer, 6004h and 6000h. Both engines agree.
- [[measured]] [[probe:chfontpr]], with the PostScript printer's information context: its own faces, AvantGarde to ZapfDingbats, 4002h; the TrueType faces from the printer 4006h, `TRUETYPE_FONTTYPE` and `DEVICE_FONTTYPE`; with `CF_PRINTERFONTS` alone Courier 4002h and Modern 4000h, the screen's bit gone as read out, where with `CF_BOTH` they are 6002h and 6000h. Not yet on the engines: their GDI makes no information context for a Windows printer driver.

## Nuances

- [[read out]] `CF_NOVECTORFONTS` is a test of the character set, not the type. [[inferred]] Any face of `OEM_CHARSET` goes with it, Terminal among them; [[probe:chfont]] asks for it only beside `CF_SCALABLEONLY`, which leaves Terminal out already.
- [[read out]] Faces the flags keep out after enumerating -- only the screen's without `CF_SCREENFONTS`, not both with `CF_WYSIWYG` -- are deleted by the dialog afterwards, not here ([[topic:choose-font]]).

## Inside Windows

[[read out]] `COMMDLG.DLL` seg4 `1096`, `retf 0Eh`: the `LOGFONT` far pointer at `[bp+10h]`, the `TEXTMETRIC` at `[bp+0Ch]`, the type at `[bp+0Ah]` and the data at `[bp+6]`. The dialog passes its address straight from the entry table, with no `MakeProcInstance`: the exported prologue loads COMMDLG's data segment.

## Implementation

WinBox's own: `FontFamilyEnumProc` in `src/win16/commdlg/choose-font.ts` and `font_family_enum_proc` in `crates/winbox-win16/src/commdlg/choose_font.rs`, handed to the engines' `EnumFontFamilies` at its stub's address with the data laid out below the stack as COMMDLG's own stack holds it. It works with no `COMMDLG.DLL` on the drive.
