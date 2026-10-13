---
kind: topic
name: Display driver resources
summary: The resources a Windows 3.1 display driver carries — its OEMBIN tables of metrics, default colours and palette, its OEM bitmaps, cursors and icons — how USER and Control Panel reach them through GetModuleHandle("DISPLAY"), GetDriverResourceID and FindResource, and what four drivers hold; read out and recorded.
probes: [drvres, chrome]
---

A display driver is an `NE` library whose module is always called `DISPLAY`, whatever its file: `VGA.DRV`, `EGA.DRV`, `HERCULES.DRV` or `SUPERVGA.DRV` ([[topic:display-drivers]]). Besides its code it carries resources:

- the OEM bitmaps USER draws window frames with;
- the standard cursors and icons;
- three resources of its own type, `OEMBIN`.

A program reaches them as it reaches any module's: [[fn:KERNEL.GetModuleHandle]] of "DISPLAY", then [[fn:KERNEL.FindResource]].

## What the VGA's driver holds

[[measured]] `VGA.DRV`'s resource table has these:

| Resources                                               | What                                                      |
| ------------------------------------------------------- | --------------------------------------------------------- |
| Bitmaps 32734–32767                                     | The OEM bitmaps: the `OBM_` boxes, arrows and check marks |
| Cursor groups 32512–32516 and 32640–32645, cursors 1–11 | The standard cursors                                      |
| Icon groups 32512–32516, icons 12–24                    | The standard icons                                        |
| `OEMBIN` 1                                              | 112 bytes: metrics and default colours (below)            |
| `OEMBIN` 2                                              | 208 bytes: Color's 48 basic colours                       |
| `OEMBIN` "FONTS"                                        | 80 bytes: three font descriptions (below)                 |
| `STRINGS` 1000, 1010                                    | Strings                                                   |

## OEMBIN 1: metrics and default colours

[[read out]] USER reads `OEMBIN` 1 once, at start-up (`USER.EXE` seg3 `0c9f`):

1. It asks `GetModuleHandle("DISPLAY")` and `GetProcAddress` of ordinal 450, the driver's `GetDriverResourceID`.
2. If the driver has that function, it asks it for the resource's number. If not, it takes 1.
3. It finds and loads the resource and reads it front to back.

The layout, as USER reads it. USER keeps each word in its data segment (seg3 `0e11`-`0ee2`), and copies them into its table of system metrics, which `GetSystemMetrics` reads at `[74h + 2 × index]`, once the rest of its start-up has set the others (seg3 `1446`-`14f3`):

| Offset       | Words          | What USER makes of them                                                                                                                                                                                                                                                                                                                                  |
| ------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `+0`         | 1              | `SM_CYVTHUMB`, the height of a vertical scroll bar's thumb (`[680h]`, then `[86h]`)                                                                                                                                                                                                                                                                      |
| `+2`         | 1              | `SM_CXHTHUMB`, the width of a horizontal one's (`[67Eh]`, then `[88h]`)                                                                                                                                                                                                                                                                                  |
| `+4` to `+A` | 4              | `SM_CXICON`, `SM_CYICON`, `SM_CXCURSOR` and `SM_CYCURSOR` (`[68Ah]`, `[68Ch]`, `[692h]`, `[694h]`). Where the first word is above 10 all four are the sizes themselves; otherwise each is a divisor, of 64 for the icon's two and of 32 for the cursor's (seg3 `0e26`). The icon's width plus 8 and its height plus 2 are kept too (`[686h]`, `[688h]`). |
| `+C`         | 1              | `SM_CYKANJIWINDOW` (`[69Ah]`, then `[98h]`), which the task switcher also takes off the screen's height (seg24 `0440`)                                                                                                                                                                                                                                   |
| `+E`         | 1              | `SM_CXBORDER` (`[6A0h]`), and four times it `SM_CXDLGFRAME`                                                                                                                                                                                                                                                                                              |
| `+10`        | 1              | `SM_CYBORDER` (`[6B4h]`), and four times it `SM_CYDLGFRAME`                                                                                                                                                                                                                                                                                              |
| `+12`        | 19 `COLORREF`s | The default system colours, `COLOR_SCROLLBAR` to `COLOR_BTNTEXT`, into `[590h]`. USER adds `COLOR_INACTIVECAPTIONTEXT` as black and `COLOR_BTNHIGHLIGHT` as white itself (seg3 `0eb6`–`0ee2`).                                                                                                                                                           |

[[read out]] The two thumbs' sizes and the borders are also copied into the scroll bars' and the frames' own tables (seg3 `1794`-`17bb`), and the borders are read throughout USER wherever a frame or a border is drawn: some 140 places.

[[measured]] [[probe:drvres]] reads `OEMBIN` 1 on four displays:

|                                      | VGA, Super VGA | EGA        | Hercules   |
| ------------------------------------ | -------------- | ---------- | ---------- |
| The thumbs                           | 17, 17         | 14, 18     | 15, 16     |
| The icon's and the cursor's divisors | 2, 2, 1, 1     | 2, 2, 1, 1 | 2, 2, 1, 1 |
| The Kanji window, the borders        | 0, 1, 1        | 0, 1, 1    | 0, 1, 1    |

- The thumbs are each display's `SM_CYVTHUMB` and `SM_CXHTHUMB` as [[probe:chrome]] recorded them, and the borders and dialog frames, 1 and 4, too.
- The icons and cursors are 32 by 32 on all four.
- The 19 colours are each display's default colours exactly: the VGA's `C0C0C0` scroll bar, `800000` caption and `808080` shadow; the EGA's `818181` scroll bar and white button face; the Hercules's greys. `GetSysColor` answers them on an installation with no `[colors]` section. [[fn:USER.GetSysColor]] has the tables.

## OEMBIN 2 and FONTS

- [[measured]] **`OEMBIN` 2** is a count and then that many `COLORREF`s.
  - The colour drivers have 48: Color's basic colours, read by `MAIN.CPL` seg6 `24ef` through the same `GetDriverResourceID` path, at most 48 taken.
  - The Hercules's has 16 greys.
- [[measured]] **`OEMBIN` "FONTS"** is the same on all four drivers: a count of 12, then three entries naming Terminal, Courier and Helv. Nothing read out so far uses it.
- [[measured]] **No driver of the four has an `OEMBIN` 3**, and none exports ordinal 450. `GetProcAddress` answers nought, so USER and Control Panel take the resources by their own numbers.
- [[read out]] **The 256-colour display's driver**, `SVGA256.DRV`, does export ordinal 450, `GetDriverResourceID` (seg1 `2d6e`), and so do `8514.DRV` and `XGA.DRV` (below). Where the driver runs at 120 dots an inch (its `[0FCh]` 78h) it answers 1, 3, and any number above 7F87h with 2000 added; otherwise, and for any other number, the number it was given. It has `OEMBIN` 1, 2, 3, "FONTS", 2001 and 2003. At the 96 dots an inch the oracle's 256-colour display runs at ([[probe:devcaps]] on `vga256`), USER is answered 1, and `OEMBIN` 1 is the VGA's word for word. `OEMBIN` 2001, for 120 dots an inch, has thumbs of 22 and 21 and the VGA's colours.

## Control Panel's "Windows Default"

[[read out]] Color builds its first scheme from the driver (`MAIN.CPL` seg6 `2922`–`2a4f`):

1. It finds `OEMBIN` 1 as USER does and skips the 18-byte header.
2. It writes "Windows Default=" and then 19 colours with `%lX,`. They go in a scheme's order, taken by `COLOR_` index from a table at `ds:03F8`: 1, 12, 5, 8, 4, 7, 2, 3, 9, 10, 11, 6, 0, 15, 16, 18, 17, 13, 14.
3. It adds `0,ffffff` for the last two.
4. It inserts the line first in its schemes' combo box with `CB_INSERTSTRING`, before `CONTROL.INI`'s `[color schemes]`.

With no `OEMBIN`, there is no "Windows Default" to choose. The scheme on the VGA is:

`Windows Default=C0C0C0,FFFFFF,FFFFFF,0,FFFFFF,0,800000,FFFFFF,FFFFFF,C0C0C0,C0C0C0,0,C0C0C0,C0C0C0,808080,0,C0C0C0,800000,FFFFFF,0,ffffff`

## In winbox.js

- **TypeScript engine.** The `DISPLAY` module keeps the installation's driver file as its resources (`displayResources` in `src/win16.ts`).
- **Rust engine.** A kept module's resources are its file's (`Owner::Kept` in `crates/winbox-win16/src/resources.rs`). `DISPLAY`'s file is the display's own driver (`kept_path`). Before, `GetModuleFileName` answered `VGA.DRV` on every display.
- **What works.** `FindResource`, `LoadResource`, `LockResource` and `SizeofResource` work on `DISPLAY`'s handle in both engines. `GetProcAddress` of 450 answers nought on the drivers without it, and on `SVGA256.DRV`, `8514.DRV` and `XGA.DRV` the entry, which answers as the driver does (`display-resource-id.ts`, `Display::resource_id`).
- **USER's start-up read.** Both engines read the display driver's `OEMBIN` as USER does, once as Windows starts: the one `GetDriverResourceID` answers 1 with, else 1. They take its two thumbs, icon and cursor sizes, Kanji window and borders into the display's metrics, and its 19 colours and the two USER adds as the default colours. `oembinValues` in `src/win16/user/oembin.ts`, called from `displayResources`; `oembin_values` and `take_display_oembin` in `crates/winbox-win16/src/display.rs`, called as the first program is loaded. The resource is 2001 on `8514s` and `xga640`, and 1 on every other display. Without the driver's file, as in tests with no installation, the tables per display (`display-modes.ts`) stand; on all seven drivers they agree with `OEMBIN` 1 exactly, so no probe's answer moved.
- [[measured]] [[probe:drvres]]: 208 of 208 records on four displays in the Rust engine. The TypeScript engine runs it whole on the VGA only: 53 of 53. [[probe:chrome]], [[probe:sizing]], [[probe:syscol]] and `devcaps` on the 256-colour display agree as before in both.
- [[measured]] Control Panel's Color lists "Windows Default" first and writes its colours to `WIN.INI`, in both engines' sessions.

## `GetDriverResourceID`

[[read out]] Three drivers export ordinal 450: `SVGA256.DRV` (seg1 `2d6e`), `8514.DRV` (seg6 `02be`) and `XGA.DRV` (seg3 `008e`). Each takes the number asked and a pointer to the type, which it does not look at. It answers `MAKEINTRESOURCE` of a number, nought in the high word: 2000 more for some numbers at some settings, and every other number as it is ([[topic:display-drivers]] has which, mode by mode). Who asks it:

- [[read out]] **USER, for `OEMBIN` 1**, as it starts (`USER.EXE` seg3 `0cb1`, `0dcc`-`0df2`). It keeps the entry's address at `[9BEh]` from `GetProcAddress(GetModuleHandle("DISPLAY"), 450)`.
- [[read out]] **USER, for every bitmap, and every cursor's or icon's group, asked of the display's instance** (seg12 `02dc`-`031f`). That is `LoadBitmap`, `LoadCursor` and `LoadIcon` with `NULL`, which USER takes for the display's instance, or with the display's own handle, and a number rather than a name. It finds the number the driver answers, and answering nought finds nothing. The cursor or icon a group names is then found by its own number, unasked (seg12 `0374`-`03ef`).
- [[read out]] **GDI, for `OEMBIN` 3**, the three stock fonts' descriptions (`GDI.EXE` seg2 `02b9`-`02fd`). A driver without ordinal 450 is asked for `OEMBIN` "FONTS" instead.
- [[read out]] **Control Panel's Color**, for `OEMBIN` 1 and 2 (`MAIN.CPL` seg6 `2922`, `24ef`).

[[read out]] A number plus 2000 can pass 7FFFh, and the OEM bitmaps' do: 32754 becomes 34754. KERNEL finds a number with its top bit set as the resource numbered by the low fifteen bits, so 34754 is found as 1986. The drivers keep the small set of OEM bitmaps there, at 1966 to 1999.

Both engines follow it ([[topic:display-drivers]]):

- the `OEMBIN` USER reads as it starts;
- the OEM bitmaps USER draws with, and `LoadBitmap(NULL, ...)`, keyed by the numbers USER asks for (`bitmapsAsAsked`, `Display::as_asked`);
- `LoadBitmap` on the display's own handle;
- `GetProcAddress` of ordinal 450, through each driver's own export table.

## Not yet done

- **The other metrics.** The scroll bars' widths and heights, the caption's, the menu's and the sizing boxes' come from the OEM bitmaps' sizes and the system font, not from `OEMBIN`; both engines still take them from the recorded or read-out tables.
- **`GetDriverResourceID` on the 256-colour display** is not recorded. `SVGA256.DRV` answers every number as it is at 96 dots an inch, so nothing a program sees there moves.
- **`OEMBIN` 3 and "FONTS".** GDI makes its stock fonts from them; both engines make the stock fonts from a table of their own, recorded on the VGA ([[probe:text]]). [[read out]] The first entry, Terminal, is 20 rows by 10 in the 8514/a's `OEMBIN` 3 where the VGA's "FONTS" has 12 by 8; the XGA's `OEMBIN` 3 has it 10 rows by 20.
