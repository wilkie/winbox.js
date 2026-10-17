---
kind: function
module: COMMDLG
name: FontStyleEnumProc
ordinal: 18
summary: The Font dialog's style enumeration procedure — given to GDI's EnumFontFamilies for the face chosen, it lists each style with a copy of its LOGFONT and its type, and the face's sizes: the sixteen standard ones for a scalable font, its own for a raster one.
versions:
  '3.1': stub
probes: [chfont]
topics: [common-dialogs, choose-font, font-enumeration]
---

## Observed behaviour

No program calls it. Each time the face changes, the Font dialog gives its far address to [[fn:GDI.EnumFontFamilies]] with the face's name, for the screen with `CF_SCREENFONTS` and the structure's `hDC` with `CF_PRINTERFONTS`. GDI calls it for each style with its `ENUMLOGFONT`, its `NEWTEXTMETRIC`, its font type and the dialog's data; it always answers 1.

- [[read out]] The data (`COMMDLG.DLL` seg4 `1aea`): the styles' combo box at 2, the sizes' at 4, the device context enumerated at 6, the `Flags` at 8, the face's type from its row in the faces' list at 0Ch, a word at 0Eh asking for the standard sizes, and the `CHOOSEFONT` at 12h.
- [[read out]] A font whose type's low three bits are not the face's -- raster, device and TrueType -- is passed over (`185c`).
- [[read out]] **Sizes.** Not raster: the sixteen standard sizes, 8 to 72, while the sizes' list is empty (`1745`). Raster: its own size, `MulDiv(tmHeight − tmInternalLeading, 72, LOGPIXELSY)` of the device enumerated, written with `"%d"` (`267c`), where not listed. Either way each is put in order by its number, once, and with `CF_LIMITSIZE` only within `nSizeMin` to `nSizeMax` (`1400`).
- [[read out]] **The style** keeps the face's screen and printer bits (`18f0`). TrueType: named by `elfStyle`, at the `ENUMLOGFONT`'s 72h, typed `ITALIC_FONTTYPE` for `NTM_ITALIC`, `BOLD_FONTTYPE` for `NTM_BOLD` and `REGULAR_FONTTYPE` for neither (`18fd`). Another: "Bold Italic" for a weight of 700 or more and italic, "Bold", "Italic" or "Regular", with the matching type (`1944`).
- [[read out]] Each style is added by `153e`: not where its name is listed already; inserted in order of weight, an italic after the upright of the same weight (`14bb`); and its data a copy of its `LOGFONT` in 50 bytes of COMMDLG's local memory as the low word, its type as the high word.
- [[measured]] [[probe:chfont]] records Arial's styles, Regular 2404h, Italic 2204h, Bold 2104h and Bold Italic 2304h, with the sixteen sizes, and Courier's Regular 2401h with sizes 10, 12 and 15. Both engines agree.

## Nuances

- [[read out]] The styles a face lacks are added after the enumeration by the dialog, not here, unless `CF_NOSIMULATIONS` ([[topic:choose-font]]).
- [[read out]] For the printer the dialog sets its device context's mapping mode to `MM_TEXT` around the enumeration and puts it back after, so a raster printer font's size is in its own pixels.

## Inside Windows

[[read out]] `COMMDLG.DLL` seg4 `184e`, `retf 0Eh`; its address is passed straight from the entry table (seg4 `1c56`, `1ce5`).

## Implementation

Not WinBox's own yet: ordinal 18 is a stub in `src/win16/commdlg/index.ts` (popping 14 bytes) with no arm in `crates/winbox-win16/src/commdlg/mod.rs`. With `COMMDLG.DLL` on the drive the file's code runs it, through the engines' `EnumFontFamilies`.
