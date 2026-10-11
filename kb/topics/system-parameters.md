---
kind: topic
name: System parameters
summary: What SystemParametersInfo reads and sets in Windows 3.1, action by action — USER's own copy of each setting, the WIN.INI key and section each is written to and in what form, WM_WININICHANGE and its lParam, what a new border width does to the metrics and to every sizable window, the desktop's pattern and wallpaper and how the desktop is drawn with them, the icons' title font, and where USER reads them all as it starts.
probes: [sysparam, sizing, deskwall, deskbrsh, dblrect]
---

[[fn:USER.SystemParametersInfo]] is how Control Panel's Desktop, Mouse and Keyboard read the settings they show and set the ones chosen. USER keeps each setting in its own data segment, reads them all from `WIN.INI` as it starts, and writes one back only when asked. [[probe:sysparam]] reads every action's setting at the start, sets each with and without `SPIF_UPDATEINIFILE` and `SPIF_SENDWININICHANGE`, reads `WIN.INI` back with [[fn:KERNEL.GetProfileString]] after each, and logs what two windows at the top, one shown and one hidden, are sent meanwhile. Both engines agree with all 116 records.

Before, winbox.js answered only the icons' spacing, their titles' wrapping and their font. Every other action answered FALSE and wrote nothing into the caller's word, so Desktop showed whatever its stack held — a granularity of 8307 and a border of 268 — and nothing the applets set reached `WIN.INI`.

## The call

- [[read out]] The export (`USER.EXE` seg41 `1895`) checks its arguments: an action past 36 and a `fuWinIni` with bits other than the low two are reported to KERNEL's parameter validation as warnings, and the call goes on; a pointer that is not null must be writable. The work is at seg41 `0ed6`, which jumps through a table of 36 places (`16a5`) by the action less one.
- [[measured]] An action the table has no case for answers FALSE and writes nothing: 0, 7, 8, 9, 37, 100 and 8000h, each with its buffer left as it was. 7, 8 and 9 are in the table, sent to the same place as the ones past it (`1693`).
- [[read out]] Every action that is taken answers TRUE (`1709`). The ones that can refuse are named below.
- [[read out]] A reading action writes through the pointer it is given without looking at it: a null pointer faults. winbox.js answers FALSE instead.

## WIN.INI and WM_WININICHANGE

- [[read out]] With `SPIF_UPDATEINIFILE` (bit 0), an action that changes a setting writes it with [[fn:KERNEL.WriteProfileString]], through a helper (`0e91`) that loads the section's name and the key's from USER's string table: `Windows` (string 0) or `Desktop` (string 50h). The value is the number given, as `wsprintf`'s `%d` writes it, unless the table below says otherwise. Whether the last write took is kept (`bp-6Ch`), with the section's name (`bp-3Ch`).
- [[measured]] The section's name is matched without regard to case, so `[windows]` stays as the file spells it; a key not in the file is added at the end of its section. At the end of the probe the keys of `[windows]` are as the installation had them, and `[Desktop]` lists `Pattern` last, written again after it was taken away.
- [[read out]] With `SPIF_SENDWININICHANGE` (bit 1) as well, where the last write took, USER sends `WM_WININICHANGE` with `HWND_BROADCAST` (`16ed`). Without a write nothing is sent: `SPIF_SENDWININICHANGE` alone sends nothing.
- [[read out]] `SendMessage` with `HWND_BROADCAST` (seg1 `a786`, `22e3`), for `WM_WININICHANGE` and `WM_DEVMODECHANGE` with a string, copies the string into a block of [[fn:KERNEL.GlobalAlloc]]'s, `GMEM_DDESHARE`, and passes its address, freeing the block afterwards (seg1 `0093`). It sends to every window at the top in the order [[fn:USER.EnumWindows]] takes them, passing over the windows of USER's classes 8000h (menus), 8003h and 8004h (icons' titles).
- [[measured]] `wParam` is nought and `lParam`'s offset is nought, the block's. Its text is the section, `Windows` or `Desktop`, as the string table spells it. The shown window is told before the hidden one, and the hidden one is told too.

## Each action

The settings USER keeps are in its data segment, seg45; the brackets give where.

| Action                                                        | What it reads or sets                                                                                     | `WIN.INI`                                                                                                                     |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1, 2 `SPI_GETBEEP`, `SPI_SETBEEP`                             | Whether `MessageBeep` sounds, `[14Ch]`: the word given, as given; `SPI_GETBEEP` answers 5 after 5 was set | `[Windows] Beep=`, `Yes` or `No` (strings 68h, 69h)                                                                           |
| 3, 4 `SPI_GETMOUSE`, `SPI_SETMOUSE`                           | Three words: the mouse's two thresholds and its speed                                                     | `MouseThreshold1`, `MouseThreshold2`, `MouseSpeed`; a message where any of the three took                                     |
| 5, 6 `SPI_GETBORDER`, `SPI_SETBORDER`                         | The sizing frame's width, `[4F8h]`, 1 to 50                                                               | `BorderWidth=`, the number given, not the one kept: 0 is kept as 1 and written as 0, 80 kept as 50 and written as 80          |
| 10, 11 `SPI_GETKEYBOARDSPEED`, `SPI_SETKEYBOARDSPEED`         | The low five bits of `[0E6h]`                                                                             | `KeyboardSpeed=`                                                                                                              |
| 22, 23 `SPI_GETKEYBOARDDELAY`, `SPI_SETKEYBOARDDELAY`         | Bits 5 and 6 of `[0E6h]`                                                                                  | `KeyboardDelay=`                                                                                                              |
| 12 `SPI_LANGDRIVER`                                           | A language driver loaded from the file named                                                              | `SYSTEM.INI`'s `[boot] LANGUAGE.DLL=`, with `WritePrivateProfileString`; no message                                           |
| 13, 24 `SPI_ICONHORIZONTALSPACING`, `SPI_ICONVERTICALSPACING` | `SM_CXICONSPACING`, `SM_CYICONSPACING` (`[0C0h]`, `[0C2h]`)                                               | `[Desktop] IconSpacing=`, `IconVerticalSpacing=`, the spacing kept                                                            |
| 14, 15 `SPI_GETSCREENSAVETIMEOUT`, `SPI_SETSCREENSAVETIMEOUT` | The screen saver's delay in seconds, `[0E8h]`                                                             | `ScreenSaveTimeOut=`                                                                                                          |
| 16, 17 `SPI_GETSCREENSAVEACTIVE`, `SPI_SETSCREENSAVEACTIVE`   | Whether it is active: the delay's sign                                                                    | `ScreenSaveActive=`, 1 or 0                                                                                                   |
| 18, 19 `SPI_GETGRIDGRANULARITY`, `SPI_SETGRIDGRANULARITY`     | The sizing grid, `[6E8h]`, eight pixels to a unit                                                         | `[Desktop] GridGranularity=`                                                                                                  |
| 20 `SPI_SETDESKWALLPAPER`                                     | The wallpaper, from the file named                                                                        | `[Desktop] Wallpaper=`, the name given, or `(None)` for none                                                                  |
| 21 `SPI_SETDESKPATTERN`                                       | The desktop's pattern                                                                                     | `[Desktop] Pattern=`, the text given; none given takes the key away                                                           |
| 25, 26 `SPI_GETICONTITLEWRAP`, `SPI_SETICONTITLEWRAP`         | Whether icons' titles wrap, `[1B2h]`                                                                      | `[Desktop] IconTitleWrap=`, 1 or 0                                                                                            |
| 27, 28 `SPI_GETMENUDROPALIGNMENT`, `SPI_SETMENUDROPALIGNMENT` | `SM_MENUDROPALIGNMENT`, `[0C4h]`, 1 or 0                                                                  | `MenuDropAlignment=`, the number given: 4 is kept as 1 and written as 4                                                       |
| 29, 30 `SPI_SETDOUBLECLKWIDTH`, `SPI_SETDOUBLECLKHEIGHT`      | `SM_CXDOUBLECLK`, `SM_CYDOUBLECLK` (`[0BCh]`, `[0BEh]`), as given                                         | `DoubleClickWidth=`, `DoubleClickHeight=`                                                                                     |
| 31 `SPI_GETICONTITLELOGFONT`                                  | The icons' titles' `LOGFONT`, `[91Ah]`                                                                    | —                                                                                                                             |
| 32 `SPI_SETDOUBLECLICKTIME`                                   | [[fn:USER.SetDoubleClickTime]]'s time: nought is 500                                                      | `DoubleClickSpeed=`, the number given: 0 is written as 0                                                                      |
| 33 `SPI_SETMOUSEBUTTONSWAP`                                   | [[fn:USER.SwapMouseButton]] with 1 for any number but nought                                              | `SwapMouseButtons=`, 1 for 1 and 0 for anything else: 2 swaps them and writes 0                                               |
| 34 `SPI_SETICONTITLELOGFONT`                                  | The icons' titles' `LOGFONT`                                                                              | `[Desktop] IconTitleFaceName=`, `IconTitleSize=` (the height as kept, -11), `IconTitleStyle=` (1 for a weight of 700, else 0) |
| 35, 36 `SPI_GETFASTTASKSWITCH`, `SPI_SETFASTTASKSWITCH`       | Whether Alt+Tab switches at once, `[1AEh]`: 1 for 1, else 0                                               | `CoolSwitch=`, the one kept                                                                                                   |

The keys with no section named are `[Windows]`'s. [[measured]] Each row's value as written, and as read back, is a record of [[probe:sysparam]].

### The keyboard

- [[measured]] The speed and the delay share one word, and neither is cut to its bits. `SPI_SETKEYBOARDSPEED` ORs the number given into the word with the low five bits cleared, and `SPI_SETKEYBOARDDELAY` the number given shifted up five with bits 5 and 6 cleared. 40 as a speed reads back as a speed of 8 and a delay of 1; a delay of 6 then as a delay of 2 and a speed of 8.
- [[read out]] Each sets the keyboard driver's repeat with its `SetSpeed` (`KEYBOARD.7`, seg3 `248c`) and keeps what it answers. [[measured]] The driver answered the word it was given each time.

### The screen saver

- [[read out]] The delay is kept negative while the screen saver is not active, so one word holds both. `SPI_SETSCREENSAVETIMEOUT` keeps the sign; `SPI_SETSCREENSAVEACTIVE` turns it. Both first note the time, `SYSTEM`'s millisecond count, in `[0FAh]`; [[inferred]] the screen saver's delay is counted from it.
- [[measured]] With a delay of nought there is no sign to turn: `SPI_SETSCREENSAVEACTIVE` with 1 then reads back as not active. `SPI_GETSCREENSAVETIMEOUT` answers the delay without its sign: 60 while not active.

### The icons

- [[read out]] `SPI_ICONHORIZONTALSPACING` and `SPI_ICONVERTICALSPACING` read where the pointer given has a selector, whatever its offset (`11ed`), and set from `uParam` where it does not. A `uParam` of nought sets nothing and answers TRUE.
- [[measured]] A spacing narrower than an icon is kept as the icon's width or height: 10 is kept, and written, as 32. These are the metrics themselves: [[fn:USER.GetSystemMetrics]] answers 32 for `SM_CXICONSPACING` and `SM_CYICONSPACING` afterwards.
- [[measured]] `SPI_SETICONTITLEWRAP` with titles wrapping already does nothing, and writes nothing: setting 1 over 1 left no key. Setting 0 over 0 writes it again. Any number but nought is 1, and written as 1.
- [[read out]] Setting the wrapping or the font shows each visible icon's title again (seg41 `0d6e` with no change in size).

### The icons' titles' font

- [[measured]] `SPI_GETICONTITLELOGFONT` copies as many bytes as `uParam` asks for: none for nought, the height and width for 4, the whole `LOGFONT` for 50. Past 50 it copies on through USER's data: asked for 60, the byte after the `LOGFONT` is nought.
- [[measured]] `SPI_SETICONTITLELOGFONT` takes a `LOGFONT` with a `uParam` of 50 and nothing else, answering FALSE for 49. With no `LOGFONT` it needs a `uParam` of nought, answering FALSE for 3, and reads the font from `WIN.INI` again as it does as it starts.
- [[measured]] With no `LOGFONT` and `SPIF_UPDATEINIFILE`, nothing is written, but the call goes on as though a write had taken: with `SPIF_SENDWININICHANGE` every window is sent `WM_WININICHANGE` with an empty section's name. [[read out]] The name is USER's stack buffer, never filled on this path; empty is what the probe saw.
- [[measured]] The size is written as the height kept, -11, and read back as points as USER starts: -11 points at 96 dots to the inch makes a height of -14, not of 15, by USER's own `MulDiv` (seg1 `39ab`), which adds half the divisor and divides toward nought: (-11 × 96 + 36) / 72.

### The border

- [[read out]] A new border width changes the metrics USER keeps (seg3 `24bc`, `253b`): `SM_CXFRAME` is `SM_CXBORDER` times the width plus one, and `SM_CYFRAME` likewise; `SM_CXMINTRACK` and `SM_CXMIN` are twice the frame and a part that does not change, and `SM_CYMINTRACK` and `SM_CYMIN` twice `SM_CYBORDER` times the width and a part that does not.
- [[measured]] On the VGA: a width of 5 makes the frame 6 by 6 and the smallest window 106 by 30; 1 makes them 2 and 98 by 22; 50, the most, 51 and 196 by 120; 3, `WIN.INI`'s, 4 and 102 by 26.
- [[read out]] Every window with a sizing frame grows by the change, so its client area stays the size it was (seg41 `0e49`, `0d6e`): each window at the top and each child, depth first, is moved and sized with `SWP_NOZORDER`, `SWP_NOREDRAW`, `SWP_NOACTIVATE` and 100h; a minimized one keeps its icon and is given a larger place to be restored to. Then everything is drawn again.
- [[measured]] A window at (20, 20) to (320, 220) is at (18, 18) to (322, 222) with a width of 5, and at (-27, -27) to (367, 267) with 50; its client area is 292 by 173 throughout.
- [[measured]] A width the same as the one kept does nothing: 3 over 3 wrote no key and sent no message, though `SPIF_UPDATEINIFILE` was given.

### The pattern

- [[read out]] `SPI_SETDESKPATTERN` (seg41 `0a61`, the export `OldSetDeskPattern` at `0a51` calls it with -1) lets go of the pattern's bitmap it kept (`[5ECh]`). With -1 it reads `[Desktop]`'s `Pattern`; a pointer given with -1 is refused. None there answers FALSE. "(None)" there, in any case, is no pattern (`0b1b`).
- [[read out]] A text given is compared with "(None)" in a buffer of USER's stack that only the way through `WIN.INI` fills (`0aea`-`0afd`): given directly, "(None)" is read as numbers like any other text. [[measured]] [[probe:deskwall]] and [[probe:deskbrsh]] give it so, and the desktop is then a pattern all of noughts, the background colour's nearest undithered -- solid dark grey on the EGA, black on the Hercules, where the desktop as Windows starts is a dither of light grey. An empty text or none at all is no pattern.
- [[read out]] The text is read as sixteen numbers (`0b2d`-`0b82`): each is the digits after any characters that are not, as signed bytes, accumulated in a word, nought where the text has run out. Their words are the rows of a monochrome bitmap 16 by 16 (`0b91`), so each number's low byte is a row of eight pixels, its highest bit the leftmost, and the brush takes the first eight rows. [[measured]] "128 64,32x16 8 4 2 259" is a diagonal from the top left whose last row is `03h`.
- [[read out]] The brush (`090c`): the bitmap blitted onto a bitmap of the screen's, 16 by 16, with the text colour `COLOR_BACKGROUND` and the background colour `COLOR_WINDOWTEXT`, and `CreatePatternBrush` of that. [[measured]] Its noughts are `COLOR_BACKGROUND` and its ones `COLOR_WINDOWTEXT`, each the nearest colour the display has, never dithered; a blit from monochrome to monochrome is a copy, so on the Hercules the noughts are black and the ones white whatever the colours.
- [[read out]] No pattern, the brush is `CreateSolidBrush` of `COLOR_BACKGROUND` (`0ba6`), patterned as the driver patterns a colour ([[topic:brush-dithering]]). [[fn:USER.SetSysColors]] makes the desktop's brush of its colour again, and then the pattern's brush again from the bitmap kept (seg41 `0c06`-`0d42`): [[measured]] teal and red make the pattern teal and red.
- [[measured]] Every window at the top is sent `WM_SYSCOLORCHANGE` as the pattern is made, before `WIN.INI` is written and any `WM_WININICHANGE`: with nought and nought. [[read out]] Then the desktop and every window is drawn again, frames and all (`0bea`, seg1 `3ed7` with `485h`): [[measured]] a window shown is sent `WM_PAINT`, `WM_NCPAINT`, `WM_GETTEXT` and `WM_ERASEBKGND`.
- [[measured]] With -1 and no `Pattern` in `[Desktop]`, it answers FALSE and sends nothing. With -1 and `SPIF_UPDATEINIFILE` it writes the pointer it was given, which must be null, and so takes `Pattern` away: the next -1 answers FALSE.

### The wallpaper

- [[read out]] `SPI_SETDESKWALLPAPER` (seg21 `04d2`) first lets go of the wallpaper's bitmap and palette, whatever comes after. It takes the file named, or with none `[Desktop]`'s `Wallpaper`; none there answers FALSE. A name that is "(None)" in any case is no wallpaper and is taken. Otherwise it reads `[Desktop]`'s `TileWallpaper` (1 by default) and `WallpaperStyle` (nought) into one word, opens the file with [[fn:KERNEL.OpenFile]] and loads it (seg21 `0131`); a file that will not load answers FALSE and leaves no wallpaper.
- [[read out]] The file is `BM` in its first fourteen bytes, then a header -- 12 bytes is the old form, with colours of three bytes; anything else is read as the 40-byte one -- and its colours, up to 1,064 bytes in all, and its bits from where the first fourteen say. A bitmap of a bit a pixel is made with `CreateBitmap`, monochrome; any other with `CreateCompatibleBitmap`, the screen's; the bits are set with [[fn:GDI.SetDIBits]].
- [[read out]] The bits' size is `biSizeImage`, or where that is nought the width times the bit count, rounded up to a doubleword, times the height (`01f5`-`0229`). Nothing checks the bit count, and what `SetDIBits` answers is not looked at (`030f`): whatever the display driver makes of the bits, the bitmap is the wallpaper, and the call answers TRUE.
- [[read out]] On a display with `RC_PALETTE` (`[0ECh]`, seg3 `0d5e`), unless `WallpaperStyle` has bit 2, a palette is made first of the colour table (seg21 `0000`): as many entries as `biClrUsed` says, else as the bits allow -- `1 << bits` in a word, which for 16 bits is nought, a palette of no entries; for 24 bits or more, 32 among them, 256 of a cube (`00d3`-`0118`): the red stepping by 20h, the green by 20h as the red comes round, the blue by 40h, so eight reds, eight greens and four blues. It is selected for the bitmap's making and realized for the desktop -- and, as USER's `SelectPalette` makes any window's but the active one's (seg6 `00a2`-`011f`), in the background.
- [[read out]] Then `WallpaperOriginX` and `WallpaperOriginY` (`061b`-`0647`). Not tiled, an origin of nought is the one that centres the bitmap: half of what the screen leaves around it, toward nought (`064a`-`0688`).
- [[read out]] For the tiling, the bitmap is copied into a larger one of whole tiles, about half the screen's width by an eighth of its height (seg21 `0347`-`049f`); the screen shows the same.
- [[measured]] A file not there, a file that is not a bitmap and an empty name answer FALSE, and write nothing even with `SPIF_UPDATEINIFILE`. A two-by-two bitmap of sixteen colours is taken. With no name and no `Wallpaper` it answers FALSE; with no name and `SPIF_UPDATEINIFILE`, `Wallpaper=(None)` is written whatever was loaded. `(none)` given is written as `(none)`.
- [[read out]] Then the desktop and every window are drawn again (seg41 `13ec`, as for the pattern). [[measured]] A window shown is sent `WM_PAINT`, `WM_NCPAINT`, `WM_GETTEXT` and `WM_ERASEBKGND`, and on the 256-colour display no `WM_PALETTECHANGED`.

### The desktop drawn

[[read out]] The desktop window's procedure (seg1 `9e6b`) erases with the wallpaper where there is one (seg21 `086e`), and with its brush where not: `UnrealizeObject` and `PatBlt` over the clip box, `PATCOPY`, the brush from the screen's corner. A double click on the desktop is `WM_SYSCOMMAND` with `SC_TASKLIST` ([[topic:task-list]]), made a double click by the same rule as any window's ([[topic:system-queue]]).

- [[read out]] The wallpaper is drawn in the screen's terms, whatever device context it is given (seg21 `086e`: the viewport moved back by the context's origin). Tiled (`06e8`), the bitmap is repeated every way from its origin, as far as the clip box. Not tiled (`07b7`), it is drawn once at its origin, and the rest of the clip box filled with the desktop's brush.
- [[read out]] A top-level window's icon is erased with the wallpaper, or with the desktop's brush from the screen's corner (`DefWindowProc` for `WM_ICONERASEBKGND`, seg1 `58d4`-`58ec`).
- [[read out]] An icon's title (seg1 `6984`) is never the wallpaper: lit, `COLOR_ACTIVECAPTION`'s brush and `COLOR_CAPTIONTEXT`; not, a window at the top's title is the desktop's brush, and a child's its parent's class brush, or `COLOR_APPWORKSPACE`'s where it has none. Not lit, the text is black where the brush's colour, red, green and blue added, is more than 381, and white where it is not (`69c7`-`69f9`) -- not `COLOR_WINDOWTEXT`. [[measured]] Over a pattern it is white: the pattern brush's colour as `GetObject` reads it adds to no more than 381.

[[measured]] [[probe:deskwall]] sets a pattern, changes the colours, then a wallpaper of sixteen colours 13 by 7 tiled, tiled from an origin, centred, and placed; one of a bit a pixel; one of 256 greys; and "(None)" for each, reading back the desktop's corner, the middle of the screen and an icon with its title after each step. Recorded on the VGA, the EGA, the Super VGA, the Hercules and the 256-colour display, both engines agree with all 512 records of each, but that the TypeScript engine runs the probe only on the VGA and the 256-colour display.

- The pattern from the screen's corner, and so continuous under an icon and its title.
- Tiled from the origin given, where `WallpaperOriginX=5` puts the bitmap's column 8 at the screen's left; centred at `(313, 236)` for 13 by 7 on 640 by 480; at `(7, 9)` with that origin, the pattern about it.
- A bitmap of a bit a pixel shows black and white, as a new device context's text and background colours make it.
- 256 greys are shown on the 16-colour displays as the nearest of the sixteen, the driver's own rule, and on the 256-colour display as they are, in slots of the system palette.

### Wallpapers of more than eight bits a pixel

[[read out]] The display drivers set a bitmap's bits from a DIB of 1, 4, 8 or 24 bits a pixel and one plane, and answer nought for any other: VGA.DRV's `DeviceBitmapBits` setting a bitmap's bits (seg9 `0059`-`0080`) and getting them (`078d`-`07b4`) and its `SetDIBitsToDevice` (`0ed0`-`0ef4`), and SVGA256.DRV's (seg9 `0197`-`01be`). GDI hands the bits to the driver's `DeviceBitmapBits` (`GDI.EXE` seg11 `091e`).

[[measured]] [[probe:deskdeep]] writes a bitmap 8 by 8 at 16, 24 and 32 bits a pixel, a row a colour -- black, white, dark red, a grey of 64 and one of 160, orange (255, 128, 0), a blue (0, 0, 200) and a green (100, 200, 50) -- sets each into a white bitmap of the screen's with [[fn:GDI.SetDIBits]], then sets each as the wallpaper, tiled, and reads back the desktop's corner. On the VGA and on the 256-colour display:

- `SetDIBits` answers 8 for 24 bits, and nought for 16 and for 32, leaving the bitmap white.
- `SPI_SETDESKWALLPAPER` answers TRUE for all three.
- 24 bits are each pixel matched on its own, with no dithering. On the VGA it is the driver's rule for the sixteen colours, as for a colour table: the grey of 64 black, of 160 dark grey, orange yellow, the blue bright blue and the green bright green. On the 256-colour display it is the cube's nearest entry, in its slot: the cube realized in the background takes the free slots in its order, an entry the static colours have takes that, and the entries left over when the slots run out -- (224, 224, 192), white's nearest, among them -- the nearest colour there is, the static `C0DCC0`.
- 16 and 32 bits show what the bitmap's memory held. The probe does not read them: for 32 bits after 24 it was the 24 bits' bitmap, just let go of and given again; for 16 bits, colours of no rule.

Both engines agree with all 24 records of each display. Control Panel's Desktop given a wallpaper of 24 bits shows it, in both engines' sessions (`crates/winbox-web/tests/sweep_terminal_control.rs`, `test/win16/sweep_terminal_control_test.ts`).

[[probe:deskbrsh]] fills beside the desktop with a brush of `COLOR_BACKGROUND` of its own, as Windows starts, after `RedrawWindow`, after [[fn:USER.SetSysColors]], and after "(None)" given to `SPI_SETDESKPATTERN`: the program's own brush is dithered throughout, and the desktop's only until the pattern of noughts.

## As USER starts

[[read out]] USER reads each setting from `WIN.INI` as it starts, in seg3. Most go through a helper (`0286`) that asks [[fn:KERNEL.GetProfileString]] for one character of `[Windows]`'s entry and gives the default where there is none, else asks [[fn:KERNEL.GetProfileInt]]: so `KeyboardSpeed=` with nothing after it is the default, but `KeyboardSpeed=x` is nought.

| Setting                                                                   | Read as                                                                                                                                                 | Default                                                                                                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KeyboardSpeed`, `KeyboardDelay` (`0356`)                                 | The helper; the delay's two low bits put above the speed. With no speed the word is 15, and no delay is read; with no delay the speed alone             | —                                                                                                                                                       |
| `MouseThreshold1`, `MouseSpeed`, `MouseThreshold2` (`03f9`)               | The helper; the second threshold read only for a speed of 2                                                                                             | The mouse driver's own threshold; 1; 10. [[measured]] `SPI_GETMOUSE` answers 2, 0, 1 on the installation the probes run on, which has none of the three |
| `CursorBlinkRate` (`1182`)                                                | The helper, to [[fn:USER.SetCaretBlinkTime]]                                                                                                            | 500                                                                                                                                                     |
| `DoubleClickSpeed` (`1190`)                                               | The helper, to [[fn:USER.SetDoubleClickTime]], which takes nought for 500                                                                               | 0                                                                                                                                                       |
| `DoubleClickWidth`, `DoubleClickHeight`, `MenuDropAlignment`              | The helper                                                                                                                                              | 4, 4, 0                                                                                                                                                 |
| `MenuShowDelay`, `MenuHideDelay`                                          | The helper                                                                                                                                              | 400 and 300 on a 286, else 0                                                                                                                            |
| `SwapMouseButtons`, `Beep` (`11ea`, `1238`)                               | `GetProfileString` for one character: Y, in either case, is yes                                                                                         | none, so not swapped; `Y`                                                                                                                               |
| `DragFullWindows`, `CoolSwitch`                                           | The helper                                                                                                                                              | 0, 1                                                                                                                                                    |
| `[Desktop] GridGranularity` (`12a2`)                                      | `GetProfileInt`, times eight, nought made 1                                                                                                             | 0                                                                                                                                                       |
| `ScreenSaveTimeOut`, `ScreenSaveActive` (`20fc`)                          | The helper; the delay made negative where not active                                                                                                    | 0, 0                                                                                                                                                    |
| `BorderWidth` (`226c`)                                                    | The helper, kept within 1 to 50                                                                                                                         | 3                                                                                                                                                       |
| `[Desktop] IconTitleFaceName`, `IconTitleSize`, `IconTitleStyle` (`1c81`) | `GetProfileString` and `GetProfileInt`; the size in points made a height on the display's dots to the inch, negative; a style's low bit a weight of 700 | MS Sans Serif, 8, 0                                                                                                                                     |
| `[Desktop] IconSpacing`, `IconTitleWrap`, `IconVerticalSpacing` (`1e33`)  | `GetProfileInt`, the spacings no less than an icon                                                                                                      | `LOGPIXELSX` × 75 / 96; 1; worked out from the title font's height                                                                                      |

- [[read out]] So a `SwapMouseButtons=1` that `SPI_SETMOUSEBUTTONSWAP` wrote does not swap the buttons the next time Windows starts: only a Y does. Control Panel's Mouse writes `yes` or `no` itself.

## What Control Panel calls

[[read out]] The applets are in `MAIN.CPL`:

- Desktop (seg18) reads the border (`14de`), the icons' spacing (`1510`), their titles' wrapping (`152f`), the screen saver's delay (`155e`), the grid (`0e4f`) and fast Alt+Tab (`11e5`). On OK it sets fast Alt+Tab (`0bca`), the grid and the spacing from their fields (`0c02`, `0c26`), the wrapping (`0c3e`), the border where it changed (`1936`) and the screen saver, each with `SPIF_UPDATEINIFILE`, the delay with `SPIF_SENDWININICHANGE` too (`1a0a`); then `SPI_SETDESKPATTERN` with -1 and nothing to write (`1a19`), the pattern having been written by Desktop itself. It sets a wallpaper with `SPI_SETDESKWALLPAPER` and nothing to write, and writes `Wallpaper` itself (`0e09`, `0e2a`).
- Mouse (seg16) reads the mouse with `SPI_GETMOUSE` and sets it as its slider moves with nothing to write (`058d`); on OK it writes `SwapMouseButtons` as `yes` or `no` and `DoubleClickSpeed` itself, where they changed (`074d`, `07d0`), and sets the mouse with both flags (`07df`). On Cancel it puts back the double-click time with [[fn:USER.SetDoubleClickTime]], the buttons with [[fn:USER.SwapMouseButton]] and the mouse with nothing to write.
- Keyboard (seg15) reads the speed and the delay (`0099`, `00a8`), sets each as its sliders move with nothing to write, and on OK with `SPIF_UPDATEINIFILE` (`02a9`, `02be`); the delay's slider runs from 3, long, to nought.
- [[measured]] With these, Control Panel's Desktop shows a granularity of 0, a border of 3 and a delay of 2 minutes, as `WIN.INI` has them; its spin buttons and fast Alt+Tab set `GridGranularity=1`, `BorderWidth=4` and `CoolSwitch=0`. Keyboard's sliders stand at a delay of 2 and a rate of 31, and moved write `KeyboardDelay=3` and `KeyboardSpeed=29`. Mouse writes `MouseThreshold1=2`, `MouseThreshold2=0` and `MouseSpeed=1`. Both engines' sessions follow this, in `crates/winbox-web/tests/sweep_terminal_control.rs` and `test/win16/sweep_terminal_control_test.ts`.

## Not yet done

- `SPI_LANGDRIVER` answers FALSE: no language driver is loaded.
- The keyboard's repeat, the mouse's thresholds and speed and the screen saver's delay are kept and written but nothing is made of them: the host's keyboard repeats, the host's mouse moves, and no screen saver starts.
- A wallpaper of 16 or 32 bits a pixel, which the display driver sets nothing of, is black here, a new bitmap's pixels; on Windows it is what the bitmap's memory held before. `biClrUsed` given for one of 16 bits is not made a palette of here, though USER makes one of that many entries.
- On the 256-colour display the desktop is not drawn again as another palette is realized (seg1 `9f15`): the wallpaper's palette is realized once, as it is loaded.
- A static control of `SS_GRAYRECT` fills with the desktop's brush (seg25 `2226`), its pattern among it; winbox.js fills it with `COLOR_BACKGROUND`.
- Only the frame's metrics follow a new border width; how the frames are drawn at other widths is not compared with Windows.
- `SendMessage` with `HWND_BROADCAST` from a program is not yet followed; only USER's own broadcasts here are.
- A reading action with a null pointer answers FALSE where Windows faults.
- `MenuShowDelay`, `MenuHideDelay`, `DragFullWindows` and `CursorBlinkRate` are read by USER as it starts but not by winbox.js here.

## Implementation

`crates/winbox-win16/src/system_parameters.rs` and `src/win16/user/SystemParametersInfo.ts` with `system-parameters.ts` keep the settings, read when the first program starts (`InitApp`), and answer the call; `desk.ts` makes the pattern and the wallpaper, and `desktop.ts` (`desktop_paint.rs`) draws them. The double click's width and height make the rectangle a second press must be in ([[topic:system-queue]]). [[fn:USER.GetSystemMetrics]] takes the frame's, the smallest window's, the double click's, the icons' spacing and the menus' alignment from them once they are read. [[fn:USER.MessageBeep]] on the Rust engine sounds only while the beep is on.
