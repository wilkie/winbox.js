'use strict';

/**
 * The display drivers WinBox.js can pretend to be.
 *
 * A Windows program does not ask what it is running on; it asks what it is
 * drawing on, and everything it asks comes from here. It sizes a dialog from
 * `LOGPIXELSY`, decides between a sixteen colour and a two hundred and fifty
 * six colour bitmap from `NUMCOLORS`, and draws a circle that comes out round
 * only if it believed `ASPECTX` and `ASPECTY`. Answering with the browser's
 * own capabilities -- which is what we used to do, reporting 32 bits per pixel
 * and 256 colours -- tells a 1992 program something no 1992 driver could have
 * told it.
 *
 * So a mode is a thing you choose, and the numbers follow from the choice.
 *
 * The numbers are `crates/winbox-win16/data/displays.json`, the one table
 * the Rust engine (`display.rs`) and the page both read. This file says
 * where each of them comes from: each field on `DisplayMode`, and each
 * mode below.
 *
 * ## Where the numbers come from
 *
 * The modes marked `recorded` were asked of real Windows 3.1 running each
 * driver, and live in `oracle/fixtures/devcaps-*.json`. Every field below
 * matches those recordings.
 *
 * The modes marked `read out` are for drivers whose cards DOSBox has not got
 * -- the 8514/a and the XGA -- so Windows cannot be started on them and
 * nothing can be recorded. Their numbers are read out of the drivers
 * themselves: the `GDIINFO` each gives GDI from its `Enable` and what that
 * routine changes in it for the card, the mode and the machine, and the
 * system metrics USER makes from the driver's bitmaps and system font by
 * its own sums (`kb/topics/display-drivers.md`). Where a choice the driver
 * makes depends on the card, the assumption taken is said where it is. The
 * read-out method gives the recorded Super VGA 256-colour driver's numbers
 * exactly, and USER's sums give the four recorded displays' metrics exactly.
 *
 * ## What a display driver decides, and what it does not
 *
 * Two things on these modes are the driver's rather than GDI's -- `lineTie` and
 * `boldOverhang` -- and both were found by a cell of the corpus that two
 * displays draw differently with everything else held identical. `FONTS.md`
 * section 8b gathers the evidence for both, the things that turned out **not**
 * to be the driver's after looking like it, and the five readings of that shape
 * refused with their counts. Read it before adding a third.
 *
 * ## The capability bits every Windows 3.1 display driver reported
 *
 * `driverVersion`, `technology`, `rasterCaps`, `curveCaps`, `lineCaps`,
 * `polygonalCaps`, `textCaps`, `clipCaps`, `numBrushes`, `numPens`,
 * `numFonts` and `numMarkers` are identical across VGA, Super VGA and EGA in
 * the recordings, which is what makes it reasonable to assume them for a
 * driver of the same generation; a mode below says where its driver differs.
 *
 * ## The system metrics and colours
 *
 * `metricsByIndex` is every system metric the `chrome` probe recorded, by
 * `SM_` index, apart from the screen and full-screen sizes, which follow the
 * display's size: the scroll bars, borders, frames, icons, cursor, menu,
 * sizing boxes and the smallest a window may be tracked to -- and the icon
 * spacings the `sizing` probe recorded. The Super VGA's are the VGA's, and
 * so are the Super VGA 256-colour driver's, whose bitmaps and `OEMBIN` 1 are
 * the VGA's. The 8514/a's and the XGA's are read out:
 *
 * The 8514/a's and the XGA's system metrics at 1024x768 with large fonts:
 * the two drivers carry the same bitmaps and `OEMBIN` 1, and Setup gives
 * both the same system font, `8514SYS.FON`. **Read out**: USER makes each
 * from the display driver's bitmaps, its `OEMBIN` 1 and the system font
 * (`USER.EXE` seg3 `0ee8`-`1124`, `1446`-`14f3`, `1dc5`-`1ef0`,
 * `24bc`-`24dd`, `253b`-`256b`), and the same sums give the VGA's, the
 * EGA's and the Hercules's recorded tables exactly. Here:
 *
 * * `OBM_CLOSE` is 52 by 26, so the caption's buttons are 26 by 26 (30,
 *   31), and the caption is the larger of a border and 26 and the font's 20
 *   rows, and a border: 28 (4).
 * * The menu bar is the button's 26, the font being shorter (15).
 * * `OBM_UPARROW` and `OBM_LFARROW` are 21 by 22: the scroll bars (2, 3,
 *   20, 21). `OEMBIN` 1's thumbs are 22 and 21 (9, 10).
 * * The smallest window is two frames, five of USER's average characters
 *   of the font -- ten -- and three buttons across, 136, and two frames of
 *   three borders and a caption down, 34 (28, 29, 34, 35).
 * * The icons are spaced 75/96 of the 120 dots an inch across, 93, and
 *   down a quarter icon, two borders, an icon and four borders, and two
 *   lines of the icon titles' 8-point MS Sans Serif, 16 rows at 120 dots,
 *   each with a border: 78 (38, 39).
 *
 * The XGA's system metrics at its small-font settings (`xga256s`), where its
 * `GetDriverResourceID` moves the OEM bitmaps to the small set, 1966 to
 * 1999, which are the VGA's bitmaps exactly, and Setup gives it the VGA's
 * fonts. **Read out**, by USER's sums as for the large fonts: the caption,
 * the menu, the scroll bars, the buttons and the smallest window are the
 * VGA's. What is not:
 *
 * * The thumbs are 22 and 21 (9, 10): the XGA's `OEMBIN` 1, and 2001 too,
 *   which 640x480 takes, have the large thumbs whichever bitmaps go with
 *   them.
 * * At 1024x768 the dots an inch stay 120, which the mode table gives and
 *   `XGA_Resources` does not change, so the icons are spaced 93 across and
 *   78 down (38, 39), as on `xga256`: two lines of the icon titles' 8-point
 *   MS Sans Serif at 120 dots, 16 rows each.
 *
 * And at 640x480 (`xga640`), at 96 dots an inch: the icons spaced as the
 * VGA's, the thumbs 22 and 21.
 *
 * `sysColors` are the system colours, by `COLOR_` index, as `COLORREF`s:
 * USER's defaults for each display when `WIN.INI` has no `[colors]` section,
 * which none of the oracle's installations has. Recorded by the `chrome`
 * probe on each display. The Super VGA's are the VGA's. The EGA's scroll bar
 * colour, `818181`, is not one of the sixteen, so it is a dithered colour;
 * the Hercules's are greys. The Super VGA 256-colour driver's are the VGA's
 * (its `OEMBIN` 1).
 *
 * The 8514/a's and the XGA's default colours: their `OEMBIN` 1's nineteen,
 * the same in both drivers, and the two USER adds. **Read out**. Some are
 * the 256-colour palette's own static colours rather than the sixteen's: the
 * desktop is `A0A0A4`, the caption and the selection `A4C8F0`, the
 * application workspace `FFFBF0`; and the caption's text is black.
 *
 * ## The modes
 *
 * `vga`, `svga`, `ega`: **recorded**. The EGA's pixels are not square:
 * ninety-six dots per inch across and seventy-two down. Anything laying out
 * in logical units has to know, and a program that assumes otherwise draws
 * ovals. Its colours are its driver's, which are not quite the VGA's (`palette:
 * 'ega'`; see `DevicePalette.EGA`).
 *
 * `hercules`: **recorded**. The same two resolutions an EGA reports --
 * ninety-six across and seventy-two down -- and a wholly different pixel:
 * eleven wide to sixteen tall where an EGA's is thirty-eight to forty-eight.
 * The two numbers say opposite things here, which is what makes this display
 * worth recording: every rule settled on a VGA and an EGA had those two
 * agreeing in direction, and here they do not. The Hercules driver is a
 * different one and says so: it offers fewer raster operations than the
 * colour drivers, no clipping of its own, a brush count rather than "as many
 * as you like", and ten pens where they have eighty; and no mouse trails
 * (`escapes`). And it draws a line differently, which none of the capability
 * bits say. The three colour drivers break a tie toward the smaller y; this
 * one breaks it by the slope: 192 of 740 lines land elsewhere than they do on
 * a VGA, and the rule that predicts all 740 is in `BitmapContext.stroke`. And
 * it draws the emboldening overhang where the colour drivers drop it: of the
 * 6,046 cells of the glyph sweep, the two displays that report ninety-six by
 * seventy-two disagree about ten, every one of them bold, and in every one
 * this display has exactly one more pixel at the right-hand end of a row. See
 * `Surface.fillText`.
 *
 * `vga256`: **recorded**. Microsoft's Super VGA driver from the Windows
 * Driver Library, on a Tseng ET4000: the profile `8et4480` of its own
 * `OEMSETUP.INF`. What differs from the sixteen-colour drivers, **recorded**
 * by `devcaps`: `NUMCOLORS` is the twenty reserved colours, not the palette's
 * 256; `RASTERCAPS` adds `RC_PALETTE`, `RC_STRETCHBLT` and `RC_STRETCHDIB`
 * and drops `RC_SAVEBITMAP`; `TEXTCAPS` drops `TC_EA_DOUBLE`; and the driver
 * counts 100 pens. A packed byte per pixel rather than planes, and a palette
 * to go with it: twenty reserved entries, a palette of 256 and 18 bits of
 * colour resolution, where a sixteen colour driver reports none of them.
 * `brightLowStatics`: **read out** of SVGA256.DRV's palette routine (seg5
 * `0278`: below index 10, `cmp al,80h` / `mov al,0C0h` before `shr al,2`),
 * and **recorded** by `palshot`, a swatch of each static colour taken from
 * the screen: the six dark colours show at C0h, the grey of 80h at 248 as
 * its entry. Its `GetDriverResourceID` (ordinal 450, seg1
 * `2d6e`) answers every number unchanged at the 96 dots an inch this mode
 * runs at; at 120 it would add 2000 to 1, 3 and the numbers above 7F87h. The
 * extents of the fixed mapping modes are the VGA's, not recorded.
 *
 * `8514`: IBM's 8514/a, Windows 3.1's own `8514.DRV`, as Setup's "8514/a"
 * installs it: 1024x768, large fonts. **Read out** of the driver, as it
 * answers on a card with a megabyte, in protected mode on a processor above
 * the 286, which is what winbox.js is (`GetWinFlags`, 419h).
 *
 * Its `GDIINFO` is a template in its code (seg6 `0446`), which `Enable`
 * (seg6 `0311`) copies out and changes: the dots an inch to 96 where
 * `SYSTEM.INI`'s `[8514.DRV] dpi=` says 96 (seg6 `0297`, 120 if it says
 * nothing; Setup writes 120 for "8514/a"); the bits a pixel to what the
 * card has, and the palette's size to two to that; with 8 bits,
 * `RC_PALETTE`, and the twenty static colours as the colours, the pens
 * and the palette's reserved entries; and `RC_BIGFONT` in protected mode
 * above the 286 (`__WINFLAGS`, seg6 `0374`). The card is a megabyte when
 * port 42E8h's bit 80h is set, and has 8 bits and twenty static colours
 * then (seg6 `0044`); with half a megabyte it has 4 bits and sixteen.
 *
 * What a program sees that it did not on a Super VGA: no `RC_STRETCHBLT`,
 * `RC_STRETCHDIB` or `RC_OP_DX_OUTPUT`, no `TC_EA_DOUBLE`, only
 * `LC_POLYLINE`, twenty pens, and `PC_RECTANGLE` and `PC_INTERIORS` besides
 * `PC_SCANLINE`.
 *
 * `lineTie` and `boldOverhang` are the colour drivers'. A line into a
 * bitmap in memory is worked out as `VGA.DRV`'s is, the same slices and
 * rounding (seg9 `0762`-`09d0`), so its tie is the VGA's; a solid line on
 * the screen is the coprocessor's (seg11 `03de`), whose tie the driver
 * does not hold. Its text is not read.
 *
 * `QUERYESCSUPPORT` answers 1 for `GETCOLORTABLE` and itself, and nought for
 * the rest, `MOUSETRAILS` among them (seg1 `1b1c`). Its `Control` answers
 * any other escape with the escape's own number (seg1 `1b28`-`1b35`,
 * `1b7e`), and GDI's `Escape` passes that back (`GDI.EXE` seg7
 * `04f0`-`0526`). Its `GetDriverResourceID` (ordinal 450, seg6 `02be`)
 * answers every number unchanged at 120 dots an inch on a card with a
 * megabyte. `Enable` puts the twenty static colours into the DAC itself, a
 * component of exactly 80h as BFh but in 808080 (seg1 `2ab7`-`2b26`); the
 * driver's `SetPalette` writes what it is given (seg9 `03d4`). GDI sends the
 * whole palette only where a realization changes it (`GDI.EXE` seg22 `0e51`,
 * `0fd3`) or `SetSystemPaletteUse` restores the statics (`0af3`). See
 * `shown-colours.ts`. Its twenty static colours are the Super VGA's but for
 * the tenth, `a4c8f0` for `a6caf0` (data `3B8h`); see
 * `DevicePalette.TWO_FIFTY_SIX_IBM`. The extents of the fixed mapping modes
 * are the template's.
 *
 * `xga256`: IBM's XGA, Windows 3.1's own `XGA.DRV`, as Setup's "XGA (Large
 * fonts)" installs it. **Read out** of the driver, as it answers on a card
 * with a megabyte and a monitor that takes 1024x768, in protected mode on a
 * 486, which is what winbox.js is (`GetWinFlags`, 419h).
 *
 * Its `GDIINFO` is built at run time (seg3 `0755`): a template in its data
 * (seg11 `178c`) with the sizes left as -1, and a table of modes for the
 * monitor the card reports (seg3 `0236`), each with the memory it needs,
 * the monitor's size and pixels an inch, the screen's size, the dots an
 * inch and the bits a pixel; the first the card's memory allows is taken
 * (seg3 `05e4`, the memory counted at `03ce`). `SYSTEM.INI`'s
 * `[XGA_DISPLAY] XGA_Resolution=1` makes it 640x480 at 96 dots whatever the
 * monitor, and `WIN.INI`'s `ColorPreferred=Y` makes a 16-colour choice that
 * (seg3 `0693`, `0c1c`); Setup writes neither for "XGA (Large fonts)".
 * Then, at 8 bits: twenty static colours, 120 pens, `RC_PALETTE`; and
 * `RC_BIGFONT` only where `__WINFLAGS` has both `WF_PMODE` and
 * `WF_CPU386`, which a 486's do not.
 *
 * The monitor is an assumption: of the three in the table that take
 * 1024x768 (ids 9, 10, 11), the one 280 by 210 millimetres, the 8514/a's
 * own size, with 92 pixels to the inch, which the mapping modes' viewports
 * are.
 *
 * `QUERYESCSUPPORT` answers 1 for `GETCOLORTABLE` and itself, nought for the
 * rest (seg1 `1316`); `Control` answers nought to any other escape (`132c`,
 * `140f`). Its `GetDriverResourceID` (ordinal 450, seg3 `008e`) answers every
 * number unchanged at 1024x768 with `XGA_Resources=2`. Its static colours are
 * the 8514/a's twenty (data `1BD9h`). The mapping modes' windows are the
 * template's; every viewport the monitor's 92 pixels an inch.
 *
 * `8514s`: the 8514/a as Setup's "8514/a (Small fonts)" installs it:
 * `[8514.DRV] dpi=96`. **Read out**: `Enable` makes the dots an inch 96 and
 * changes nothing else (seg6 `0297`, `0311`); its `GetDriverResourceID` (seg6
 * `02be`) then adds 2000 to 1 and 3 and to the numbers above 7F87h, so USER
 * takes `OEMBIN` 2001 -- thumbs of 17, the large set's colours -- and the
 * small OEM bitmaps, 1966 to 1999, which are the VGA's exactly; GDI takes
 * `OEMBIN` 2003, its stock fonts at the VGA's sizes. Setup gives it the VGA's
 * fonts, so USER's sums give the VGA's metrics. The mapping modes' extents
 * are the template's: `Enable` changes only the dots an inch.
 *
 * `xga256s`: the XGA as Setup's "XGA (Small fonts)" installs it:
 * `[XGA_Display] XGA_Resources=1`. **Read out**: the driver reads it into
 * `[1869h]` (seg3 `072c`-`0743`), which nothing but `GetDriverResourceID`
 * reads (seg3 `008e`): at 1024x768 it adds 2000 to the numbers above 7F87h,
 * the OEM bitmaps, and leaves `OEMBIN` 1 and 3 as they are. The mode, and so
 * the dots an inch, are the monitor's, 120, as for `xga256`.
 *
 * `xga640`: the XGA as Setup's "XGA (640x480, 256 colors)" installs it:
 * `XGA_Resolution=1` and `XGA_Resources=1`. **Read out**: the first sets
 * `[1868h]` to nought (seg3 `06fc`-`0707`), and `Enable` then makes the mode
 * 640x480 at 8 bits and 96 dots an inch whatever the monitor's (seg3
 * `0c89`-`0cb4`); the millimetres and the mapping viewports stay the
 * monitor's mode's, monitor 10's here as for `xga256`. `GetDriverResourceID`
 * adds 2000 to 1 and 3 and to the bitmaps: USER takes `OEMBIN` 2001 and the
 * small OEM bitmaps, GDI `OEMBIN` 2003.
 */

import displays from '../../crates/winbox-win16/data/displays.json';

/** A driver whose numbers were read out of real Windows. */
export const RECORDED = 'recorded';

/** A driver whose numbers were read out of its code, Windows not run on it. */
export const READ_OUT = 'read out';

/** One display mode: what its driver says of itself, and what follows. */
export interface DisplayMode {
  /** What it is called. */
  name: string;

  /** The driver's file, as the distribution's `SETUP.INF` names it; its
   * module is `DISPLAY` whichever it is. */
  driverFile: string;

  /** What it is: "VGA, 640x480, 16 colours". */
  description: string;

  /** `RECORDED` or `READ_OUT`. */
  provenance: string;

  driverVersion: number;

  /** The escapes the driver answers `QUERYESCSUPPORT` for, with the
   * answer: `GETCOLORTABLE`, `QUERYESCSUPPORT` itself and, on the colour
   * drivers, `MOUSETRAILS`, which they answer -7 for. **Recorded** by
   * `escapes` on the VGA, the Super VGA and the EGA. */
  escapes: Record<string, number>;

  /** What `MOUSETRAILS` answers. */
  mouseTrails: number;

  /** A raster display, as opposed to a plotter or a film recorder: 1. */
  technology: number;

  rasterCaps: number;
  curveCaps: number;
  lineCaps: number;
  polygonalCaps: number;
  textCaps: number;
  clipCaps: number;

  /** How the driver breaks a tie when a line passes exactly between two
   * pixels: `top`, toward the smaller y, as every Windows 3.1 colour
   * driver recorded here does; `slope` on the Hercules. See
   * `BitmapContext.stroke`. */
  lineTie: string;

  /** Whether it draws the emboldening overhang where the smear would need
   * a byte more of the destination row: `byte`, the colour drivers, drop
   * it; `always`, the Hercules. See `Surface.fillText`. */
  boldOverhang: string;

  /** Brushes are made on demand rather than drawn from a pool: -1. */
  numBrushes: number;
  numPens: number;
  numFonts: number;
  numMarkers: number;

  /** Only a palette device reserves entries or reports a palette size and
   * a colour resolution. */
  numReserved: number;
  sizePalette: number;
  colorRes: number;

  /** `NUMCOLORS`, where it is not `colors`: a palette device's reserved
   * colours. */
  numColors?: number;

  width: number;
  height: number;

  /** The physical size the driver claims, in millimetres. */
  widthMillimetres: number;
  heightMillimetres: number;

  logicalPixelsX: number;
  logicalPixelsY: number;
  aspectX: number;
  aspectY: number;
  aspectXY: number;

  /** Sixteen colours are four one-bit planes rather than four bits in a
   * byte, which anything building a bitmap by hand has to know. */
  bitsPerPixel: number;
  planes: number;
  colors: number;

  /** The device palette, where it is not the VGA's: `ega`, `8514`. */
  palette?: string;

  /** The window and viewport extents of `MM_LOMETRIC`, `MM_HIMETRIC`,
   * `MM_LOENGLISH`, `MM_HIENGLISH` and `MM_TWIPS`, as window x and y,
   * viewport x and y: the driver's own. **Recorded** by `mapmode`. */
  mappingExtents: number[][];

  /** The system metrics that follow from the driver rather than from
   * Windows. A caption bar is as tall as the system font needs it to be, so
   * a lower resolution gets a shorter one. Recorded alongside the
   * capabilities. */
  metrics: {
    captionHeight: number;
    menuHeight: number;
    borderWidth: number;
    borderHeight: number;
    frameWidth: number;
    frameHeight: number;
    iconWidth: number;
    iconHeight: number;
  };

  /** The system colours, by `COLOR_` index, as `COLORREF`s. */
  sysColors: number[];

  /** Every system metric recorded or read out, by `SM_` index. */
  metricsByIndex: Record<string, number>;

  /** What the screen shows of the first entries of the palette: a
   * component of exactly 80h goes into the DAC as C0h below this index.
   * Only what is shown: `GetSystemPaletteEntries`, `GetPixel` and the rest
   * answer the entries. */
  brightLowStatics?: number;

  /** What the driver's `GetDriverResourceID` (ordinal 450) adds 2000 to:
   * the numbers in `add`, and those above `above`. */
  resourceIds?: { add?: number[]; above?: number };

  /** Whether the driver's `Control` answers an escape it has not got with
   * the escape's own number. */
  controlAnswersNumber?: boolean;

  /** Whether the driver's `Enable` puts the static colours into the DAC
   * itself. */
  enableStatics?: boolean;
}

/** Every mode, by its name, as `displays.json` has them. */
export const DISPLAY_MODES = displays satisfies Record<string, DisplayMode>;

/** The mode a machine gets when nothing says otherwise. */
export const DEFAULT_DISPLAY_MODE = 'vga';

/**
 * Looks a mode up by name.
 *
 * @param {string} name - One of the keys of `DISPLAY_MODES`.
 * @returns {object} The mode.
 */
export function displayMode(name) {
  const mode = DISPLAY_MODES[name];

  if (!mode) {
    throw new Error(`no display mode ${name}; try ${Object.keys(DISPLAY_MODES).join(', ')}`);
  }

  return mode;
}
