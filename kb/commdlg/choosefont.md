---
kind: function
module: COMMDLG
name: ChooseFont
ordinal: 15
summary: The Font dialog — a face, a style and a size from lists GDI's enumeration fills, with effects and a colour where asked — answering whether OK was pressed and writing the LOGFONT, the point size, the type and the flags; read out of COMMDLG.DLL and recorded.
versions:
  '3.1': exact
probes: [chfont, chfont2]
topics: [common-dialogs, choose-font]
source: src/win16/commdlg/choose-font.ts
---

## Observed behaviour

[[probe:chfont]] opens the dialog with seven sets of flags and uses it with the keys through USER's `KEYBD_EVENT`, recording the controls, the four lists, what the hook and the owner are sent, the boxes the dialog puts up, and what the call answers and leaves in the `CHOOSEFONT` and its `LOGFONT`.

- [[measured]] It answers 1 for OK, writing `iPointSize` in tenths of a point, the `LOGFONT`, `nFontType`, `rgbColors` with `CF_EFFECTS` and the style's name with `CF_USESTYLE`; and nought for Cancel. Courier, Bold Italic, 14, struck out, underlined and green answered `iPointSize` 140, `nFontType` A701h, `rgbColors` 8000h and a height of -19.
- [[measured]] Cancel does not undo what the dialog wrote before it: the default `LOGFONT` without `CF_INITTOLOGFONTSTRUCT`, a style's weight and italic with `CF_USESTYLE`, and what a refused OK wrote.
- [[measured]] `Flags` comes back with `CF_NOFACESEL`, `CF_NOSTYLESEL` and `CF_NOSIZESEL` set for a face, style or size not chosen and cleared for one chosen.
- [[measured]] What fails answers nought and sets [[fn:COMMDLG.CommDlgExtendedError]]:

| Asked                                                | Error                         |
| ---------------------------------------------------- | ----------------------------- |
| `lStructSize` not 46                                 | 1, `CDERR_STRUCTSIZE`         |
| `CF_ENABLEHOOK` and no hook                          | 0Bh, `CDERR_NOHOOK`           |
| `CF_ENABLETEMPLATE` with a name the instance has not | 6, `CDERR_FINDRESFAILURE`     |
| `CF_ENABLETEMPLATEHANDLE` with a handle of nought    | none: the error left nought   |
| `CF_LIMITSIZE` with `nSizeMin` above `nSizeMax`      | 2002h, `CFERR_MAXLESSTHANMIN` |
| neither `CF_SCREENFONTS` nor `CF_PRINTERFONTS`       | 2001h, `CFERR_NOFONTS`        |

- [[measured]] With no fonts, a box "Fonts", "There are no fonts installed; Run Control Panel to install fonts.", is put up before the call fails.
- [[measured]] A call that succeeds leaves the error nought.
- [[measured]] [[probe:chfont2]]: with a template of the program's by name, its controls that COMMDLG drives worked and those it left out -- Apply, Help, the effects, the colours, the description -- were simply not there; by handle the same, and the handle still locked after the call, not freed. A face and a style typed whole were chosen; `nFontType` A504h for Wingdings' Bold made from its Regular.
- [[measured]] With a printer's information context ([[probe:chfontpr]], the PostScript printer), the printer's device faces were listed beside the screen's and the font's description given for each kind of face.

## Nuances

- [[read out]] The error is cleared as the call starts, before the structure's size is checked, so every refusal starts from nought (`COMMDLG.DLL` seg4 `0021`).
- [[read out]] The template name and instance are not checked for nought, as [[fn:COMMDLG.ChooseColor]] checks them: `FindResource` is asked with whatever is given.
- [[read out]] The hourglass is set as the call starts; the arrow is set by the dialog's procedure as `WM_INITDIALOG` ends, and not at all where a hook answers that message. [[measured]] The cursor was the hourglass when the hook was given `WM_INITDIALOG`.
- [[read out]] Where no style is in its list at OK, `nFontType` is written from a word of the code's stack it never set (`0d90`). [[probe:chfont]] records only that it was written; WinBox writes nought.
- [[read out]] The height written is `-MulDiv(size, LOGPIXELSY, 72)` on the screen, even for a printer's font.
- [[read out]] Unlike the other dialogs' functions, it leaves a hook not asked for in the structure.
- The flags, the lists, the sample and OK step by step are in [[topic:choose-font]].

## Inside Windows

[[read out]] `COMMDLG.DLL` seg4 `0000`, `retf 4`: the checks, the template (COMMDLG's dialog 1543 unless the program gives one), the hook kept at `[17Ah]` of COMMDLG's data while `DialogBoxIndirectParam` runs [[fn:COMMDLG.FormatCharDlgProc]], -1 made `CDERR_DIALOGFAILURE`, the template freed unless it was the program's handle, and 1 answered where the dialog ended with 1.

## Implementation

WinBox's own: `ChooseFont` in `src/win16/commdlg/choose-font.ts` and `choose_font` in `crates/winbox-win16/src/commdlg/choose_font.rs`, each step and each call into USER, GDI and KERNEL as `COMMDLG.DLL` seg4 makes them, the template, the pictures of bitmap 38, the colours and the strings WinBox's own (`templates.ts`, `templates.rs`, `strings.ts`). Both engines agree with all 94 of [[probe:chfont]]'s records and all 330 of [[probe:chfont2]]'s, with `COMMDLG.DLL` on the drive or not; Write's, Paintbrush's, File Manager's and Clock's fonts are chosen with it without the file (`test/win16/font_accessories_test.ts`, `crates/winbox-web/tests/font_accessories.rs`). [[probe:chfont3]]'s list rows and [[probe:chfontpr]]'s printer wait on USER's and GDI's own ([[topic:choose-font]]).
