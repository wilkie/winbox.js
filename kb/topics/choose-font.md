---
kind: topic
name: Choose Font
summary: COMMDLG's Font dialog — the CHOOSEFONT structure and its flags, the template, the face, style, size and colour lists and how EnumFontFamilies fills them, the sample, the font's description, what OK writes and WM_CHOOSEFONT_GETLOGFONT — read out of COMMDLG.DLL and recorded.
probes: [chfont, chfont2, chfont3, chfontpr]
---

[[fn:COMMDLG.ChooseFont]] runs a modal dialog for choosing a font: a face, a style and a size from three lists, and, where the program asks for effects, strikeout, underline and one of sixteen colours, with a sample drawn in the font. Write, Paintbrush, File Manager, Clock and fibsw of the corpus use it. It is WinBox's own, in both engines, with or without `COMMDLG.DLL` on the drive (see In WinBox). Every address on this page is in `COMMDLG.DLL` seg4 unless it says otherwise; what all the common dialogs share is in [[topic:common-dialogs]].

[[probe:chfont]] records the call's errors, the dialog's controls and lists, what the hook and the owner are sent, the boxes it puts up, `WM_CHOOSEFONT_GETLOGFONT`, and what the call leaves in the structure, for seven sets of flags, with the keys as a person presses them. [[probe:chfont2]] records what the dialog draws -- the sample and the colours' box, a pixel at a time -- a face and a style typed whole, a hook that answers OK itself, a program's template by name and by handle, a raster face without simulations, and a size that is not a number; [[probe:chfont3]] the three lists' rows as drawn; [[probe:chfontpr]] the PostScript printer's fonts, on the installation with a printer. Both engines agree with all 94 of [[probe:chfont]]'s records, all 330 of [[probe:chfont2]]'s, all 201 of [[probe:chfont3]]'s and all 31 of [[probe:chfontpr]]'s, running WinBox's own `ChooseFont`, as they did running COMMDLG.DLL's.

## The structure

`CHOOSEFONT`, 46 bytes:

| Offset | Field            | What COMMDLG does with it                                                                     |
| ------ | ---------------- | --------------------------------------------------------------------------------------------- |
| 0      | `lStructSize`    | must be 46 (`002c`)                                                                           |
| 4      | `hwndOwner`      | the dialog's owner; sent `HELPMSGSTRING`'s message for Help                                   |
| 6      | `hDC`            | with `CF_PRINTERFONTS`, the printer's device context, enumerated beside the screen            |
| 8      | `lpLogFont`      | read with `CF_INITTOLOGFONTSTRUCT`; written as the dialog starts, as a style is chosen, at OK |
| 0Ch    | `iPointSize`     | written at OK: the size in tenths of a point                                                  |
| 0Eh    | `Flags`          | read; `CF_NOFACESEL`, `CF_NOSTYLESEL` and `CF_NOSIZESEL` written back                         |
| 12h    | `rgbColors`      | with `CF_EFFECTS`, the colour chosen as the dialog starts, and written at OK                  |
| 16h    | `lCustData`      | not read                                                                                      |
| 1Ah    | `lpfnHook`       | with `CF_ENABLEHOOK`                                                                          |
| 1Eh    | `lpTemplateName` | with `CF_ENABLETEMPLATE`                                                                      |
| 22h    | `hInstance`      | the template's module, or with `CF_ENABLETEMPLATEHANDLE` the template                         |
| 24h    | `lpszStyle`      | with `CF_USESTYLE`, the style chosen as the dialog starts, and written at OK                  |
| 28h    | `nFontType`      | written at OK                                                                                 |
| 2Ah    | `nSizeMin`       | with `CF_LIMITSIZE`                                                                           |
| 2Ch    | `nSizeMax`       | with `CF_LIMITSIZE`                                                                           |

[[read out]] Unlike the other dialogs' functions, `ChooseFont` does not write over a hook not asked for.

## The flags

[[read out]] Each flag where the code reads it:

| Flag                      | Value   | Read                                                                                                 |
| ------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `CF_SCREENFONTS`          | 1       | faces only the screen has are kept (`12e0`); the screen's styles enumerated (`1c39`)                 |
| `CF_PRINTERFONTS`         | 2       | the printer's faces and styles enumerated (`12b8`, `1c74`); the font's description shown (`25ca`)    |
| `CF_SHOWHELP`             | 4       | without it, Help hidden and disabled (`06ab`)                                                        |
| `CF_ENABLEHOOK`           | 8       | the hook checked (`0047`), kept (`00ef`) and called                                                  |
| `CF_ENABLETEMPLATE`       | 10h     | the program's dialog by name (`0060`)                                                                |
| `CF_ENABLETEMPLATEHANDLE` | 20h     | the program's template by handle (`00a6`); then not freed (`0147`)                                   |
| `CF_INITTOLOGFONTSTRUCT`  | 40h     | without it, the program's `LOGFONT` is set to the default first (`0517`)                             |
| `CF_USESTYLE`             | 80h     | the style chosen by `lpszStyle` (`0191`); its name written at OK (`0d9b`)                            |
| `CF_EFFECTS`              | 100h    | the effects and colours shown (`0492`, `052c`); `rgbColors` written at OK (`0d30`)                   |
| `CF_APPLY`                | 200h    | without it, Apply hidden and disabled (`047e`)                                                       |
| `CF_ANSIONLY`             | 400h    | a face whose character set is not `ANSI_CHARSET` left out (`10c6`)                                   |
| `CF_NOVECTORFONTS`        | 800h    | a face whose character set is `OEM_CHARSET` left out (`10eb`)                                        |
| `CF_NOSIMULATIONS`        | 1000h   | without it, bold and italic styles a face lacks are added (`1d3a`)                                   |
| `CF_LIMITSIZE`            | 2000h   | `nSizeMin` and `nSizeMax` checked (`0407`), the sizes listed and typed held to them (`1400`, `0ae1`) |
| `CF_FIXEDPITCHONLY`       | 4000h   | a face with `VARIABLE_PITCH` left out (`10d7`)                                                       |
| `CF_WYSIWYG`              | 8000h   | faces not both the screen's and the printer's taken out (`133d`)                                     |
| `CF_FORCEFONTEXIST`       | 10000h  | OK refused for a face or style not in its list (`0c9d`)                                              |
| `CF_SCALABLEONLY`         | 20000h  | a raster face left out (`10b9`)                                                                      |
| `CF_TTONLY`               | 40000h  | a face that is not TrueType left out (`10a6`)                                                        |
| `CF_NOFACESEL`            | 80000h  | given, no face chosen as the dialog starts (`05e2`); written back: no face in the list (`2466`)      |
| `CF_NOSTYLESEL`           | 100000h | given, no style chosen (`0633`); written back: no style in the list (`24b3`)                         |
| `CF_NOSIZESEL`            | 200000h | given, no size set (`0646`); written back: no size typed (`2522`)                                    |

[[read out]] The font types COMMDLG keeps for a face or a style, as `nFontType` answers them, are the type GDI gives the enumeration procedure in the low byte (`RASTER_FONTTYPE` 1, `DEVICE_FONTTYPE` 2, `TRUETYPE_FONTTYPE` 4), and its own bits above: `BOLD_FONTTYPE` 100h, `ITALIC_FONTTYPE` 200h, `REGULAR_FONTTYPE` 400h, `SCREEN_FONTTYPE` 2000h, `PRINTER_FONTTYPE` 4000h, `SIMULATED_FONTTYPE` 8000h.

## The template

[[read out]] COMMDLG's dialog 1543, "Font", 264 × 147 in 8-point "Helv", not `WS_VISIBLE`:

| Id   | Control                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------- |
| 440h | "&Font:"                                                                                                |
| 470h | the faces: a simple combo box, owner-drawn with fixed rows, sorted, with strings, `CBS_DISABLENOSCROLL` |
| 441h | "Font St&yle:"                                                                                          |
| 471h | the styles: a simple combo box, not owner-drawn, not sorted                                             |
| 442h | "&Size:"                                                                                                |
| 472h | the sizes: a simple combo box, owner-drawn with fixed rows, sorted, with strings                        |
| 1, 2 | OK (the default button) and Cancel                                                                      |
| 402h | "&Apply"                                                                                                |
| 40Eh | "&Help"                                                                                                 |
| 430h | the "Effects" group box, with "Stri&keout" (410h) and "&Underline" (411h), automatic check boxes        |
| 443h | "&Color:"                                                                                               |
| 473h | the colours: a drop-down list, owner-drawn with fixed rows, with strings                                |
| 431h | the "Sample" group box                                                                                  |
| 445h | the font's description, centred, `SS_NOPREFIX`                                                          |
| 444h | "AaBbYyZz", centred, not visible: the sample's place and its text                                       |

[[measured]] Every control but 444h was enabled and shown for the flags of the first run; without `CF_EFFECTS`, `CF_APPLY` and `CF_SHOWHELP`, Apply, Help, the effects and the colours were hidden and disabled.

## As the call starts

[[read out]] `ChooseFont` (`0000`):

1. The hourglass is set with `LoadCursor` and `SetCursor`, and the extended error cleared, before anything is checked.
2. `lStructSize` not 46: `CDERR_STRUCTSIZE`, 1. `CF_ENABLEHOOK` with no hook: `CDERR_NOHOOK`, 0Bh.
3. The template: with `CF_ENABLETEMPLATE`, `FindResource(hInstance, lpTemplateName, RT_DIALOG)` -- not found `CDERR_FINDRESFAILURE`, 6; not loaded `CDERR_LOADRESFAILURE`, 7. With `CF_ENABLETEMPLATEHANDLE`, `hInstance` itself. Else COMMDLG's 1543, the same two errors. Neither the name nor the instance is checked for nought, as `ChooseColor` checks them.
4. `LockResource`; nothing locked answers nought with no error set.
5. With a hook, it is kept in COMMDLG's data (`[17Ah]`) while the dialog is made.
6. `DialogBoxIndirectParam` on COMMDLG's instance, with the owner, [[fn:COMMDLG.FormatCharDlgProc]] (export 16) and the structure as its parameter. Then the kept hook is cleared; -1 is `CDERR_DIALOGFAILURE`, FFFFh, and answers nought.
7. The template is freed unless it was the program's handle. The answer is 1 where the dialog ended with 1, else nought.

[[read out]] `ChooseFont` sets the arrow back nowhere: [[fn:COMMDLG.FormatCharDlgProc]] does, as `WM_INITDIALOG` ends, unless a hook answers that message.

## As the dialog starts

[[read out]] `WM_INITDIALOG` (`037a`):

1. Strings 504h to 507h, "Regular", "Bold", "Italic" and "Bold Italic", are loaded into COMMDLG's data; any missing is `CDERR_LOADSTRFAILURE`, 5, and the dialog ends with nought.
2. With `CF_LIMITSIZE`, `nSizeMin` above `nSizeMax` is `CFERR_MAXLESSTHANMIN`, 2002h, and the dialog ends.
3. Four bytes of local memory are put under the property A000h, holding the structure's address; none is `CDERR_MEMALLOCFAILURE`, 9. The hook kept in COMMDLG's data is cleared.
4. The pictures of the faces' types are made once, from bitmap 38 (`26d9`; see below).
5. Apply is hidden and disabled without `CF_APPLY`.
6. Without `CF_EFFECTS`, the colours and their label are hidden and disabled. With it, the sixteen colours are listed (`1db7`), and the one whose colour is `rgbColors` chosen, looking from the last to the second; none found, the first, black.
7. The sample's rectangle is taken from 444h's window, in the dialog's client coordinates (`1e2d`).
8. The faces' and sizes' edit fields are given the styles' edit field's height (`025a`).
9. Without `CF_INITTOLOGFONTSTRUCT`, the program's `LOGFONT` is made the default (`1a2a`): weight 400, a height of ten points on the screen, -`MulDiv(10, LOGPIXELSY, 72)`, and everything else nought, the face empty.
10. Without `CF_EFFECTS`, the effects' group box and check boxes are hidden and disabled; with it, Strikeout and Underline are checked from the `LOGFONT`.
11. The faces are listed (`1226`); none is `CFERR_NOFONTS`, 2001h, the dialog ends, its property removed, and the hook is kept in COMMDLG's data again for what comes after.
12. Unless `CF_NOFACESEL` was given, the face named in the `LOGFONT` is chosen if it is listed, and its name put in the box.
13. The styles and sizes are listed for the face chosen (`1aaa`).
14. Unless `CF_NOSTYLESEL` was given, a style is chosen (`016d`): with `CF_USESTYLE`, the one named by `lpszStyle`, its weight and italic written into the program's `LOGFONT`, or weight 400 and not italic where no style has that name; else the one nearest the `LOGFONT`'s weight among those of its italic, or among all where that finds only the first.
15. Unless `CF_NOSIZESEL` was given, a `LOGFONT` height not nought is turned into points on the screen and written in the sizes' box, and chosen where listed.
16. Help is hidden and disabled without `CF_SHOWHELP`; the three boxes are limited to 31, 31 and 4 characters.
17. With a hook, the hook is given `WM_INITDIALOG`, and its answer is the answer. Without one, the cursor is set to the arrow and the answer is 1.

[[measured]] Given Arial, a height of -16, bold and underlined, and maroon, the dialog started with Arial, Bold and 12 in the boxes, Underline checked and maroon chosen. Given a `LOGFONT` of 55h bytes and no `CF_INITTOLOGFONTSTRUCT`, it was left with a height of -13, weight 400 and nothing else -- and, with `CF_USESTYLE` and "Bold Italic", weight 700 and italic, though the call was cancelled. The cursor was the hourglass when the hook was given `WM_INITDIALOG`.

## The faces

[[read out]] The faces are listed by `1226`. It finds GDI's [[fn:GDI.EnumFontFamilies]], by ordinal 330, with `GetProcAddress` (`EnumFonts`, ordinal 70, where COMMDLG runs on Windows 3.0), and calls it with no face name and [[fn:COMMDLG.FontFamilyEnumProc]], export 19, first for the screen, a device context from `GetDC(NULL)`, then, with `CF_PRINTERFONTS`, for the structure's `hDC`. The screen is enumerated whatever the flags say.

[[fn:COMMDLG.FontFamilyEnumProc]] has each face in turn:

- **Left out**: with `CF_TTONLY` one not TrueType; with `CF_SCALABLEONLY` a raster one; with `CF_ANSIONLY` one whose character set is not nought; with `CF_FIXEDPITCHONLY` one with `VARIABLE_PITCH`; with `CF_NOVECTORFONTS` one whose character set is `OEM_CHARSET`, 255.
- **Marked** `SCREEN_FONTTYPE` or, from the printer, `PRINTER_FONTTYPE`.
- **A face already listed** is replaced, its name inserted again at its place and the old row deleted, where the new one ranks above it: TrueType, then device, then vector, then raster, as the type ranks with the screen and printer bits cleared and its raster bit flipped (`1079`); and, with `CF_PRINTERFONTS` but not `CF_SCREENFONTS`, wherever the new is the printer's and the old the screen's. The row keeps the screen and printer bits of both -- but in that second case the old type is made nought first, and the row is the printer's alone (`1163`, `11ba`).
- **A new face** is added, its data its type. A face the list will not take ends the enumeration.

Then without `CF_SCREENFONTS` every face only the screen has is deleted, and with `CF_WYSIWYG` every face not both the screen's and the printer's. With nothing left, a box says so: caption string 500h, "Fonts", text 501h, "There are no fonts installed; Run Control Panel to install fonts.", `MB_ICONINFORMATION`, owned by the dialog.

[[measured]] On the VGA installation, the screen's faces are Arial, Courier New, Symbol, Times New Roman and Wingdings, 2004h, TrueType; Courier, Fixedsys, MS Sans Serif, MS Serif, Small Fonts, System and Terminal, 2001h, raster; and Modern, Roman and Script, 2000h, vector. `CF_ANSIONLY` left nine, without Modern, Roman, Script, Symbol, Terminal and Wingdings; `CF_TTONLY` the five TrueType faces; `CF_SCALABLEONLY`, `CF_FIXEDPITCHONLY` and `CF_NOVECTORFONTS` Courier New alone. Neither screen nor printer fonts put up the box, and the call failed with 2001h.

[[measured]] With `CF_PRINTERFONTS` and an information context on the display as its `hDC`, every face was both the screen's and the printer's, 6004h and 6000h, and `CF_WYSIWYG` with `CF_SCALABLEONLY` kept the eight vector and TrueType faces.

[[read out]] Where the printer's face meets the screen's with `CF_PRINTERFONTS` but not `CF_SCREENFONTS`, the old row's type is made nought before the bits are joined (`1163`): the row keeps the printer's bit alone, not both as a face replaced by rank does.

[[measured]] With the PostScript printer's information context ([[probe:chfontpr]]): `CF_PRINTERFONTS` alone listed eighteen faces -- the printer's AvantGarde, Bookman, Courier, Helvetica, Helvetica-Narrow, NewCenturySchlbk, Palatino, Times, ZapfChancery and ZapfDingbats, 4002h; the TrueType faces 4006h, as the printer enumerates them, `DEVICE_FONTTYPE` with `TRUETYPE_FONTTYPE`; Modern, Roman and Script 4000h -- the screen's raster faces taken out. `CF_BOTH` listed twenty-four, Courier 6002h, the printer's device face ranking above the screen's raster one, and the TrueType faces 6006h; `CF_WYSIWYG` with `CF_SCALABLEONLY` the five TrueType faces and the three vector ones.

## The styles and the sizes

[[read out]] Each time the face changes the styles and sizes are listed again (`1aaa`). The old styles' memory is freed and both lists emptied, with redrawing off while they fill. Then:

- **No face chosen**: four styles of the default `LOGFONT`, "Regular" (400h), "Bold" (100h, weight 700), "Italic" (200h) and "Bold Italic" (300h), and the sixteen sizes below.
- **A face chosen**: with `CF_SCREENFONTS`, [[fn:GDI.EnumFontFamilies]] of that face on the screen; with `CF_PRINTERFONTS`, on the printer's `hDC`, its mapping mode set to `MM_TEXT` for it and put back after, with its extents for `MM_ISOTROPIC` and `MM_ANISOTROPIC`. Each style comes to [[fn:COMMDLG.FontStyleEnumProc]], export 18.

[[fn:COMMDLG.FontStyleEnumProc]] takes only a font of the face's own kind, raster, device or TrueType, and:

- **Sizes.** For a font that is not raster, the sixteen standard sizes, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48 and 72, while the list is empty (`1745`). For a raster font, its own size, in points on the device enumerated: `MulDiv(tmHeight − tmInternalLeading, 72, LOGPIXELSY)`. Each size is put in order by its number, once, and with `CF_LIMITSIZE` only between `nSizeMin` and `nSizeMax` (`1400`).
- **Styles.** A TrueType font is named by its own style name, the `ENUMLOGFONT`'s `elfStyle`, its type `ITALIC_FONTTYPE` and `BOLD_FONTTYPE` from the `NEWTEXTMETRIC`'s flags and `REGULAR_FONTTYPE` where neither is set. Another is "Bold Italic", "Bold", "Italic" or "Regular" by its weight, 700 or more, and italic. The style keeps the face's screen and printer bits and a copy of the font's `LOGFONT`, 50 bytes of COMMDLG's local memory, as its data's low word, its type as the high word (`153e`). Styles are put in order of weight, an italic after the upright of its weight (`14bb`), and a name already listed is not added again.

[[read out]] Unless `CF_NOSIMULATIONS` is given, the styles a face lacks are made from those it has (`15ce`): "Bold" from the regular, weight 700; "Italic" from the regular, italic; "Bold Italic" from the italic, else the bold, else the regular. Each is typed with the last listed style's type, `SIMULATED_FONTTYPE` added and its own style's bits.

[[read out]] The sizes are put in order by their data (`1400`): the first row whose number is not below the new one is where it goes, and it is not added where that row's number is its own. Without a face chosen, the sizes' list is not emptied first (`1b4b`), only the styles'.

[[measured]] Arial's styles were Regular 2404h, Italic 2204h, Bold 2104h and Bold Italic 2304h, and its sizes the sixteen. Courier's were Regular 2401h, and Italic A601h, Bold A501h and Bold Italic A701h made from it -- `REGULAR_FONTTYPE` kept in each, from the type it was made with -- and its sizes 10, 12 and 15. With `CF_LIMITSIZE` of 8 to 12 the sizes were 8 to 12. MS Serif with `CF_NOSIMULATIONS` and that limit had Regular alone and 8, 10 and 12 ([[probe:chfont2]]); the printer's Courier its own four styles, 4402h, 4202h, 4102h and 4302h ([[probe:chfontpr]]).

## The colours

[[read out]] Strings 410h to 41Fh name the sixteen colours, each inserted at its place with its `COLORREF` from COMMDLG's data (`[130h]`) as its data: Black, Maroon, Green, Olive, Navy, Purple, Teal, Gray, Silver, Red, Lime, Yellow, Blue, "Fuschia", Aqua and White, the sixteen colours of the VGA. [[measured]] As read out.

## Drawing the lists

[[read out]] `WM_MEASUREITEM` (`0787`) measures the dialog's font -- `GetDC` of the dialog, its `WM_GETFONT` selected, `GetTextMetrics` -- each time it is asked: an item is its height, at least 12; the edit field, its height and one.

[[read out]] `WM_DRAWITEM` (`0805`) draws nothing for no item, and otherwise fills the row with the highlight colour for a selected item and the window's colour for another, the text in the highlight's text colour or the window's text colour:

- **A face** (`1f44`): its name with `ExtTextOut`, 20 pixels in, the row filled. A TrueType face, and a printer's device face, has a picture 20 × 12 at the row's left, centred, copied with `BitBlt` from the bitmap made of COMMDLG's bitmap 38: the left half TrueType's, the right the printer's, the top row for an item not selected and the bottom for one selected.
- **A colour** (`20c4`): the row filled by `ExtTextOut` with no text; a rectangle of the colour, a brush made of the row's data, in the default pen, `SM_CXBORDER` in from the row's left and `SM_CYBORDER` from its top and bottom, twice as wide as it is high; and its name, with `TextOut`, two `SM_CXBORDER`s right of it.
- **A size** (`1e67`): its number, `SM_CXBORDER` in.

[[read out]] Bitmap 38 is a 4-bit DIB 40 × 24. As it is loaded its colour table's pure blue is made the window's colour and its magenta the highlight's (`26d9`), and it is made a bitmap with `CreateDIBitmap` on the screen's device context; it is made again for `WM_SYSCOLORCHANGE`. The picture of a row is the bitmap's left half for a type with `TRUETYPE_FONTTYPE`, the right half for one with both `PRINTER_FONTTYPE` and `DEVICE_FONTTYPE`, placed `(height − 12) / 2` down the row.

[[measured]] The faces', styles' and sizes' rows, the pictures and the text, plain and selected, agree on the engines with Windows to the pixel ([[probe:chfont3]]). Two things of USER's and GDI's had kept them apart, with Microsoft's COMMDLG.DLL as with WinBox's: the styles' list, not owner-drawn, kept the height the System font's rows had made it, as the combo box was given the dialog's font ([[topic:combo-boxes]]); and the faces' and sizes' text, drawn with `ExtTextOut` and `ETO_OPAQUE`, stood a column a character further apart in the dialog's smeared MS Sans Serif than `TextOut` draws it ([[fn:GDI.ExtTextOut]]). [[probe:lbtext]] takes both apart. [[fn:COMMDLG.Ordinal 43]] gives it to COMMDLG's instance, and [[fn:COMMDLG.Ordinal 34]] deletes it as COMMDLG is freed.

## The sample

[[read out]] `WM_PAINT` (`226b`) draws the sample in 444h's rectangle: the font made from the dialog as it stands, as `WM_CHOOSEFONT_GETLOGFONT` makes it but without changing the program's flags, in the colour chosen with `CF_EFFECTS` and the window's text colour without, on the window's colour. The text is 444h's, "AaBbYyZz", where the face, style and size are all chosen, and nothing where not. It is centred across where it fits, its baseline placed so the ascent less the internal leading is centred down, never below the bottom, and drawn with `ETO_OPAQUE` and `ETO_CLIPPED`.

[[read out]] The face's, style's, size's, effects' and colour's changes paint it again: `InvalidateRect` of its rectangle, not erased, and `UpdateWindow`.

[[read out]] The `LOGFONT` the sample is made from is on COMMDLG's stack (`[bp-58h]`), each byte `241e` does not write -- the face's after its nought -- whatever the stack held. WinBox starts it from noughts; only the face's bytes after its nought differ, and `CreateFontIndirect` reads the face to its nought.

[[measured]] The sample of Arial, bold and italic, in navy, and of Times New Roman, bold, and the colours' box agree on the engines with Windows to the pixel ([[probe:chfont2]]), with WinBox's `ChooseFont`.

## The font's description

[[read out]] Only with `CF_PRINTERFONTS`, when the style's type changes, 445h is given (`25ca`): a simulated style, string 44Ch, "This font style is imitated for the display. The closest matching style will be used for printing."; TrueType, 44Dh, "This is a TrueType font. This same font will be used on both your printer and your screen."; a face only the screen has, 44Fh, "This is a screen font. The closest matching printer font will be used for printing."; a printer's device face, 44Eh, "This is a printer font. The closest matching Windows font will be used on your screen."; anything else, nothing. [[measured]] It stayed empty without `CF_PRINTERFONTS`. With the PostScript printer ([[probe:chfontpr]]) Courier, the printer's, was "This is a printer font."; Arial "This is a TrueType font."; MS Serif, the screen's alone, "This is a screen font."; and MS Serif's Bold, made from its Regular, "This font style is imitated for the display."

## What the controls do

[[read out]] `WM_COMMAND` (`0b9d`):

| Control               | Notification     | What                                                                                                                                               |
| --------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| the faces (470h)      | `CBN_SELCHANGE`  | the name put in the box; styles and sizes listed again; the style nearest the program's `LOGFONT` chosen; the size typed kept, chosen where listed |
| the faces             | `CBN_EDITUPDATE` | a private notification posted, 5F5h: a name typed whole chooses its face, as a selection would                                                     |
| the styles (471h)     | `CBN_SELCHANGE`  | the name put in the box, and the style's weight and italic written into the program's `LOGFONT`                                                    |
| the styles, the sizes | `CBN_EDITUPDATE` | posted 5F5h: a style typed whole is chosen                                                                                                         |
| the styles, the sizes | `CBN_KILLFOCUS`  | the sample painted                                                                                                                                 |
| the colours (473h)    | `CBN_SELCHANGE`  | the sample painted                                                                                                                                 |
| Strikeout, Underline  | any              | the sample painted                                                                                                                                 |
| OK (1)                |                  | below                                                                                                                                              |
| Cancel (2)            |                  | the styles' memory freed, the dialog ended with nought, its property removed                                                                       |
| 3                     |                  | the dialog ended with `lParam`'s low word                                                                                                          |
| Help (40Eh)           |                  | the owner sent `HELPMSGSTRING`'s message, `wParam` the dialog and `lParam` the structure, where the structure names an owner                       |
| Apply (402h)          |                  | nothing: COMMDLG leaves it to the hook                                                                                                             |

[[read out]] Where COMMDLG runs on Windows 3.0, a selection also posts a private notification, 5F4h, that copies the item's text into the box and selects it.

[[measured]] Help sent the owner `commdlg_help`'s message with the dialog and the structure. Apply reached the hook as its `WM_COMMAND`, notification nought. Down in the styles chose the next; 1 and 4 typed into the sizes left "14", though not listed.

[[measured]] "times new roman" typed into the faces' box, a key at a time, chose Times New Roman once it was whole, and "bold" typed into the styles' box chose Bold; a 9 typed and OK answered `iPointSize` 90, a height of -12 and "Bold" in `lpszStyle` ([[probe:chfont2]]). A hook answering OK's `WM_COMMAND` kept the dialog up and active.

## OK

[[read out]] OK (`0c35`):

1. The size typed is read (`0a78`) with `GetDlgItemInt`, signed. Empty, it is 10. Not a number, string 44Ah, "Size must be a number."; with `CF_LIMITSIZE` and outside `nSizeMin` to `nSizeMax`, 44Bh, "Size must be between %d and %d points.", in a box with the dialog's caption and `MB_ICONINFORMATION`; then `WM_NEXTDLGCTL` is posted to put the focus on the sizes, and the dialog stays.
2. `iPointSize` is the size times 10.
3. The program's `LOGFONT` is written (`241e`), and `CF_NOFACESEL`, `CF_NOSTYLESEL` and `CF_NOSIZESEL` set or cleared in `Flags`: see below.
4. With `CF_FORCEFONTEXIST`, a face not in the list is refused with string 502h, "Invalid font name. Choose a font from the list of fonts.", and a style not in the list with 503h, "Invalid font style. Choose a style from the list of styles.", in the same box; `WM_NEXTDLGCTL` is posted for that list, and the dialog stays.
5. With `CF_EFFECTS`, `rgbColors` is the colour chosen.
6. `nFontType` is the high word of the style's data, where the style's text is in the list. Where it is not, the word is written from a local the code never set.
7. With `CF_USESTYLE`, the style's text is copied to `lpszStyle`.
8. The styles' memory is freed and the dialog ended with 1.

[[read out]] The `LOGFONT` (`241e`): the default first; the face's text as `lfFaceName`, `CF_NOFACESEL` set where it is not in the list; then, for a style in its list, its whole `LOGFONT` copied over, width nought, else `CF_NOSTYLESEL`; then the height from the size typed, `-MulDiv(size, LOGPIXELSY, 72)` on the screen, or ten points and `CF_NOSIZESEL` with none; then `lfStrikeOut` and `lfUnderline` from the check boxes. The height is the screen's whether the font is the printer's or not.

[[measured]] "ab" typed as the size and OK put up "Size must be a number." in a box captioned "Font" ([[probe:chfont2]]).

[[measured]] With Courier, Bold Italic made from its regular, 14 typed, strikeout, underline and green: the call answered 1, `iPointSize` 140, `rgbColors` 8000h, `nFontType` A701h, and the `LOGFONT` a height of -19, weight 700, italic, underlined and struck out, character set nought, output precision 1, clipping precision 2, quality 1, pitch and family 31h and "Courier" -- the precisions, quality and family the enumeration's. 20 typed against a limit of 8 to 12, and then 0, each put up "Size must be between 8 and 12 points." and kept the dialog. With `CF_FORCEFONTEXIST` and no face, "Invalid font name." -- after `iPointSize`, the `LOGFONT`, its face emptied, and `CF_NOFACESEL` had been written; cancelled then, the call answered nought and left them so.

## WM_CHOOSEFONT_GETLOGFONT

[[read out]] `WM_USER + 1`, 401h, with a `LOGFONT` far pointer in `lParam`, is written as OK writes the program's (`0865`, `241e`), the three `CF_NO…SEL` flags of the program's structure set and cleared with it. The procedure answers 1 where the face, style and size are all chosen, nought where any is not.

[[measured]] It wrote the default `LOGFONT` with no face, and Arial's name once Arial was chosen, setting and clearing the flags as read out. `SendMessage` answered 1 each time, each with something not chosen. [[inferred]] 401h is also the dialog manager's `DM_SETDEFID`, which a dialog procedure's nought hands on to `DefDlgProc`; not yet read out of USER.

## Hooks

- [[read out]] Once the dialog has its property, each message goes first to the hook, through the structure, and an answer not nought is the procedure's (`02f0`). Before it, the hook kept in COMMDLG's data has every message but `WM_INITDIALOG` (`0317`). `WM_INITDIALOG` goes to the hook last, after the dialog is set up, with the structure as `lParam`.
- [[read out]] As the dialog ends, by OK, Cancel or a failure in `WM_INITDIALOG`, its property is removed and the hook kept in COMMDLG's data again, so it has the messages of the dialog's ending.
- [[measured]] Before `WM_INITDIALOG` the hook was given `WM_SETFONT`, then `WM_MEASUREITEM` and `WM_GETFONT` six times over, then `WM_CTLCOLOR`s.
- [[measured]] A program's template, the probe's own dialog with the faces, styles, sizes, OK, Cancel and the sample but none of the rest, worked as COMMDLG's: the controls left out were not there to hide, and the sample was drawn in its own place ([[probe:chfont2]]). A template given by handle was still locked after the call: COMMDLG does not free it.

## Errors

| Error                   | Value | Where  | When                                            |
| ----------------------- | ----- | ------ | ----------------------------------------------- |
| `CDERR_STRUCTSIZE`      | 1     | `0038` | `lStructSize` not 46                            |
| `CDERR_LOADSTRFAILURE`  | 5     | `03e2` | a style's name not loaded                       |
| `CDERR_FINDRESFAILURE`  | 6     | `0082` | the template not found                          |
| `CDERR_LOADRESFAILURE`  | 7     | `009e` | the template not loaded                         |
| `CDERR_MEMALLOCFAILURE` | 9     | `0434` | the dialog's four bytes not had                 |
| `CDERR_NOHOOK`          | 0Bh   | `0058` | `CF_ENABLEHOOK` and no hook                     |
| `CDERR_DIALOGFAILURE`   | FFFFh | `0138` | `DialogBoxIndirectParam` answered -1            |
| `CFERR_NOFONTS`         | 2001h | `05a2` | no face listed                                  |
| `CFERR_MAXLESSTHANMIN`  | 2002h | `0418` | `CF_LIMITSIZE` with `nSizeMin` above `nSizeMax` |

[[measured]] A size of 47, `CF_ENABLEHOOK` with no hook, a template name the program has not, `CF_LIMITSIZE` of 12 to 8 and no fonts answered nought with 1, 0Bh, 6, 2002h and 2001h. `CF_ENABLETEMPLATEHANDLE` with a handle of nought answered nought with no error. A call that succeeds leaves the error nought, as it cleared it.

## Resources

[[read out]] Dialog 1543; bitmap 38; strings 410h–41Fh (the colours), 44Ah and 44Bh (the size), 44Ch–44Fh (the description), 500h and 501h (no fonts), 502h and 503h (`CF_FORCEFONTEXIST`), 504h–507h (the style names); and `HELPMSGSTRING`'s message, registered as COMMDLG loads. `ChooseFont` registers nothing. Strings 306h, "FormatChar", and 307h, "FontInfo", are not loaded by this segment.

## The functions

- [[fn:COMMDLG.ChooseFont]], export 15, the call.
- [[fn:COMMDLG.FormatCharDlgProc]], export 16, the dialog's procedure.
- [[fn:COMMDLG.FontFamilyEnumProc]], export 19, and [[fn:COMMDLG.FontStyleEnumProc]], export 18, given to GDI.
- [[fn:COMMDLG.Ordinal 34]], the bitmap's deletion.

## In WinBox

WinBox's own, in both engines: `ChooseFont` (15), `FormatCharDlgProc` (16), `FontStyleEnumProc` (18) and `FontFamilyEnumProc` (19), in `src/win16/commdlg/choose-font.ts` and `crates/winbox-win16/src/commdlg/choose_font.rs`, registered in `src/win16/commdlg/index.ts` and `crates/winbox-win16/src/commdlg/mod.rs`. Each step is the read-out above, and each call into USER, GDI and KERNEL is made as COMMDLG makes it, through the function that answers a program's call (`api.ts`, `guest_calls.rs`); USER calls the procedure, and GDI's `EnumFontFamilies` the two enumeration procedures, at their stubs' addresses, as COMMDLG hands out its own exports. Dialog 1543, bitmap 38 and the sixteen colours are WinBox's own (`templates.ts`, `templates.rs`), as are the strings.

- With `COMMDLG.DLL` on the drive, a program's `ChooseFont` is linked to WinBox's; [[probe:chfont]]'s 94 records and [[probe:chfont2]]'s 330 agree on both engines.
- Without it, Write's Character ▸ Fonts, Paintbrush's Text ▸ Fonts, File Manager's Options ▸ Font and Clock's Settings ▸ Set Font open the dialog and keep the font chosen (`test/win16/font_accessories_test.ts`, `crates/winbox-web/tests/font_accessories.rs`).
- Where COMMDLG keeps its own memory -- four bytes under the property A000h, 50 bytes for each style's `LOGFONT` -- WinBox keeps them in its own, by numbers it puts where COMMDLG puts the handles. The styles' names, strings 504h to 507h, are always there, so `CDERR_LOADSTRFAILURE` cannot happen.
- Where no style is listed at OK, COMMDLG writes `nFontType` from a word of its stack it never set; WinBox writes nought.
- Only Windows 3.10's ways are taken (`[0CAEh]` at least 30Ah): not `EnumFonts`, not the notification 5F4h, not the lists invalidated after they fill.

## Not yet done

- Nothing recorded is left apart. A program's printer that is not the PostScript driver, and Windows 3.0's ways (see In WinBox), are not recorded.
