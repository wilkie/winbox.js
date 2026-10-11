---
kind: topic
name: Display driver resources
summary: The resources a Windows 3.1 display driver carries — its OEMBIN tables of metrics, default colours and palette, its OEM bitmaps, cursors and icons — how USER and Control Panel reach them through GetModuleHandle("DISPLAY"), GetDriverResourceID and FindResource, and what four drivers hold; read out and recorded.
probes: [drvres]
---

A display driver is an `NE` library whose module is always called `DISPLAY`, whatever its file: `VGA.DRV`, `EGA.DRV`, `HERCULES.DRV` or `SUPERVGA.DRV` ([[topic:display-drivers]]). Besides its code it carries resources:

- the OEM bitmaps USER draws window frames with;
- the standard cursors and icons;
- three resources of its own type, `OEMBIN`.

A program reaches them as it reaches any module's: [[fn:KERNEL.GetModuleHandle]] of "DISPLAY", then [[fn:KERNEL.FindResource]].

## What the VGA's driver holds

[[measured]] `VGA.DRV`'s resource table has these:

| Resources | What |
|---|---|
| Bitmaps 32734–32767 | The OEM bitmaps: the `OBM_` boxes, arrows and check marks |
| Cursor groups 32512–32516 and 32640–32645, cursors 1–11 | The standard cursors |
| Icon groups 32512–32516, icons 12–24 | The standard icons |
| `OEMBIN` 1 | 112 bytes: metrics and default colours (below) |
| `OEMBIN` 2 | 208 bytes: Color's 48 basic colours |
| `OEMBIN` "FONTS" | 80 bytes: three font descriptions (below) |
| `STRINGS` 1000, 1010 | Strings |

## OEMBIN 1: metrics and default colours

[[read out]] USER reads `OEMBIN` 1 once, at start-up (`USER.EXE` seg3 `0c9f`):

1. It asks `GetModuleHandle("DISPLAY")` and `GetProcAddress` of ordinal 450, the driver's `GetDriverResourceID`.
2. If the driver has that function, it asks it for the resource's number. If not, it takes 1.
3. It finds and loads the resource and reads it front to back.

The layout, as USER reads it:

| Offset | Words | What USER does with them |
|---|---|---|
| `+0`, `+2` | 2 | Kept at `[0x680]` and `[0x67E]` |
| `+4` to `+A` | 4 | Above 10: the icon's and the cursor's sizes as they are. Otherwise divisors of 64 and 32, giving `SM_CXICON`, `SM_CYICON`, `SM_CXCURSOR` and `SM_CYCURSOR` (seg3 `0e26`). The icon's size plus 8 and plus 2 are kept at `[0x686]` and `[0x688]`. |
| `+C`, `+E`, `+10` | 3 | Kept at `[0x69A]`, `[0x6A0]` and `[0x6B4]` |
| `+12` | 19 `COLORREF`s | The default system colours, `COLOR_SCROLLBAR` to `COLOR_BTNTEXT`. USER adds `COLOR_INACTIVECAPTIONTEXT` as black and `COLOR_BTNHIGHLIGHT` as white itself (seg3 `0eb6`–`0ee2`). |

[[measured]] [[probe:drvres]] reads `OEMBIN` 1 on four displays:

| | VGA, Super VGA | EGA | Hercules |
|---|---|---|---|
| The first two words | 17, 17 | 14, 18 | 15, 16 |
| The next four | 2, 2, 1, 1 | 2, 2, 1, 1 | 2, 2, 1, 1 |
| The next three | 0, 1, 1 | 0, 1, 1 | 0, 1, 1 |

- The icons and cursors are 32 by 32 on all four.
- The 19 colours are each display's default colours exactly: the VGA's `C0C0C0` scroll bar, `800000` caption and `808080` shadow; the EGA's `818181` scroll bar and white button face; the Hercules's greys. `GetSysColor` answers them on an installation with no `[colors]` section. [[fn:USER.GetSysColor]] has the tables.

## OEMBIN 2 and FONTS

- [[measured]] **`OEMBIN` 2** is a count and then that many `COLORREF`s.
  - The colour drivers have 48: Color's basic colours, read by `MAIN.CPL` seg6 `24ef` through the same `GetDriverResourceID` path, at most 48 taken.
  - The Hercules's has 16 greys.
- [[measured]] **`OEMBIN` "FONTS"** is the same on all four drivers: a count of 12, then three entries naming Terminal, Courier and Helv. Nothing read out so far uses it.
- [[measured]] **No driver of the four has an `OEMBIN` 3**, and none exports ordinal 450. `GetProcAddress` answers nought, so USER and Control Panel take the resources by their own numbers. [[inferred]] A driver that offers several resolutions would export `GetDriverResourceID` to map them.

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
- **What works.** `FindResource`, `LoadResource`, `LockResource` and `SizeofResource` work on `DISPLAY`'s handle in both engines, and `GetProcAddress` of 450 answers nought.
- [[measured]] [[probe:drvres]]: 208 of 208 records on four displays in the Rust engine. The TypeScript engine runs it whole on the VGA only: 53 of 53.
- [[measured]] Control Panel's Color lists "Windows Default" first and writes its colours to `WIN.INI`, in both engines' sessions.

## Not yet done

- **USER's own start-up read.** Neither engine reads `OEMBIN` 1 at start-up. The default colours and metrics come from tables recorded per display (`display-modes.ts`), which agree with `OEMBIN` on all four. The two 256-colour modes take the VGA's tables, where USER would take their driver's `OEMBIN`.
- **The other header words.** What USER does with `[0x680]`, `[0x67E]`, `[0x69A]`, `[0x6A0]` and `[0x6B4]` is not read out.
