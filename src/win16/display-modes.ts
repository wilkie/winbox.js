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
 */

/**
 * What a display driver decides, and what it does not.
 *
 * Two things on these modes are the driver's rather than GDI's -- `lineTie` and
 * `boldOverhang` -- and both were found by a cell of the corpus that two
 * displays draw differently with everything else held identical. `FONTS.md`
 * section 8b gathers the evidence for both, the things that turned out **not**
 * to be the driver's after looking like it, and the five readings of that shape
 * refused with their counts. Read it before adding a third.
 */

/** A driver whose numbers were read out of real Windows. */
export const RECORDED = 'recorded';

/** A driver whose numbers were read out of its code, Windows not run on it. */
export const READ_OUT = 'read out';

/**
 * The capability bits every Windows 3.1 display driver reported.
 *
 * Identical across VGA, Super VGA and EGA in the recordings, which is what
 * makes it reasonable to assume them for a driver of the same generation.
 */
const COMMON = {
  driverVersion: 778,

  /* The escapes the driver answers `QUERYESCSUPPORT` for, with the answer:
   * `GETCOLORTABLE`, `QUERYESCSUPPORT` itself and `MOUSETRAILS`, which it
   * answers -7 for; and what `MOUSETRAILS` answers. **Recorded** by
   * `escapes` on the VGA, the Super VGA and the EGA. */
  escapes: { 5: 1, 8: 1, 39: -7 } as Record<number, number>,
  mouseTrails: 7,

  // A raster display, as opposed to a plotter or a film recorder.
  technology: 1,

  rasterCaps: 18137,
  curveCaps: 0,
  lineCaps: 34,
  polygonalCaps: 8,
  textCaps: 8708,
  clipCaps: 1,

  /* How the driver breaks a tie when a line passes exactly between two
   * pixels. Every Windows 3.1 colour driver recorded here takes it to the
   * smaller y; the Hercules does not. See `BitmapContext.stroke`.
   */
  lineTie: 'top',

  /* And whether it draws the emboldening overhang where the smear would need
   * a byte more of the destination row. The colour drivers drop it; see
   * `Surface.fillText`.
   */
  boldOverhang: 'byte',

  // Brushes are made on demand rather than drawn from a pool.
  numBrushes: -1,
  numPens: 80,
  numFonts: 0,
  numMarkers: 0,

  // Only a palette device reserves entries or reports a palette size.
  numReserved: 0,
  sizePalette: 0,
  colorRes: 0,
};

/**
 * The system metrics that follow from the driver rather than from Windows.
 *
 * A caption bar is as tall as the system font needs it to be, so a lower
 * resolution gets a shorter one. Recorded alongside the capabilities.
 */
const VGA_METRICS = {
  captionHeight: 20,
  menuHeight: 18,
  borderWidth: 1,
  borderHeight: 1,
  frameWidth: 4,
  frameHeight: 4,
  iconWidth: 32,
  iconHeight: 32,
};

const EGA_METRICS = { ...VGA_METRICS, captionHeight: 18, menuHeight: 16 };

/**
 * Every system metric the `chrome` probe recorded, by `SM_` index, apart from
 * the screen and full-screen sizes, which follow the display's size: the
 * scroll bars, borders, frames, icons, cursor, menu, sizing boxes and the
 * smallest a window may be tracked to -- and the icon spacings the `sizing`
 * probe recorded. The Super VGA's are the VGA's, and so are the Super VGA
 * 256-colour driver's, whose bitmaps and `OEMBIN` 1 are the VGA's. The
 * 8514/a's and the XGA's are below, read out.
 */
const VGA_BY_INDEX = {
  2: 17,
  3: 17,
  4: 20,
  5: 1,
  6: 1,
  7: 4,
  8: 4,
  9: 17,
  10: 17,
  11: 32,
  12: 32,
  13: 32,
  14: 32,
  15: 18,
  18: 0,
  19: 1,
  20: 17,
  21: 17,
  22: 0,
  23: 0,
  28: 102,
  29: 26,
  30: 18,
  31: 18,
  32: 4,
  33: 4,
  34: 102,
  35: 26,
  38: 75,
  39: 72,
};

const EGA_BY_INDEX = {
  2: 17,
  3: 14,
  4: 18,
  5: 1,
  6: 1,
  7: 4,
  8: 4,
  9: 14,
  10: 18,
  11: 32,
  12: 32,
  13: 32,
  14: 32,
  15: 16,
  18: 0,
  19: 1,
  20: 14,
  21: 18,
  22: 0,
  23: 0,
  28: 102,
  29: 24,
  30: 18,
  31: 16,
  32: 4,
  33: 4,
  34: 102,
  35: 24,
  38: 75,
  39: 66,
};

const HERCULES_BY_INDEX = {
  2: 15,
  3: 11,
  4: 18,
  5: 1,
  6: 1,
  7: 4,
  8: 4,
  9: 15,
  10: 16,
  11: 32,
  12: 32,
  13: 32,
  14: 32,
  15: 16,
  18: 0,
  19: 1,
  20: 11,
  21: 16,
  22: 0,
  23: 0,
  28: 105,
  29: 24,
  30: 19,
  31: 16,
  32: 4,
  33: 4,
  34: 105,
  35: 24,
  38: 75,
  39: 66,
};

/**
 * The system colours, by `COLOR_` index, as `COLORREF`s: USER's defaults for
 * each display when `WIN.INI` has no `[colors]` section, which none of the
 * oracle's installations has. Recorded by the `chrome` probe on each display.
 * The Super VGA's are the VGA's. The EGA's scroll bar colour, `818181`, is not
 * one of the sixteen, so it is a dithered colour; the Hercules's are greys.
 * The Super VGA 256-colour driver's are the VGA's (its `OEMBIN` 1).
 */
const VGA_COLORS = [
  0xc0c0c0, 0xc0c0c0, 0x800000, 0xffffff, 0xffffff, 0xffffff, 0x000000, 0x000000, 0x000000,
  0xffffff, 0xc0c0c0, 0xc0c0c0, 0xffffff, 0x800000, 0xffffff, 0xc0c0c0, 0x808080, 0xc0c0c0,
  0x000000, 0x000000, 0xffffff,
];

const EGA_COLORS = [
  0x818181, 0xc0c0c0, 0x800000, 0xffffff, 0xffffff, 0xffffff, 0x000000, 0x000000, 0x000000,
  0xffffff, 0x808080, 0xffffff, 0xffffff, 0x800000, 0xffffff, 0xffffff, 0x808080, 0x808080,
  0x000000, 0x000000, 0xffffff,
];

const HERCULES_COLORS = [
  0x3f3f3f, 0x7f7f7f, 0x000000, 0xffffff, 0xffffff, 0xffffff, 0x000000, 0x000000, 0x000000,
  0xffffff, 0x7f7f7f, 0xffffff, 0xbfbfbf, 0x000000, 0xffffff, 0xffffff, 0xffffff, 0x000000,
  0x000000, 0x000000, 0xffffff,
];

/**
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
 */
const XGA_BY_INDEX = {
  2: 21,
  3: 22,
  4: 28,
  5: 1,
  6: 1,
  7: 4,
  8: 4,
  9: 22,
  10: 21,
  11: 32,
  12: 32,
  13: 32,
  14: 32,
  15: 26,
  18: 0,
  19: 1,
  20: 22,
  21: 21,
  22: 0,
  23: 0,
  28: 136,
  29: 34,
  30: 26,
  31: 26,
  32: 4,
  33: 4,
  34: 136,
  35: 34,
  38: 93,
  39: 78,
};

const XGA_METRICS = { ...VGA_METRICS, captionHeight: 28, menuHeight: 26 };

/**
 * The 8514/a's and the XGA's default colours: their `OEMBIN` 1's nineteen,
 * the same in both drivers, and the two USER adds. **Read out**. Some are
 * the 256-colour palette's own static colours rather than the sixteen's: the
 * desktop is `A0A0A4`, the caption and the selection `A4C8F0`, the
 * application workspace `FFFBF0`; and the caption's text is black.
 */
const XGA_COLORS = [
  0xc0c0c0, 0xa4a0a0, 0xf0c8a4, 0xffffff, 0xffffff, 0xffffff, 0x000000, 0x000000, 0x000000,
  0x000000, 0xc0c0c0, 0xc0c0c0, 0xf0fbff, 0xf0c8a4, 0x000000, 0xc0c0c0, 0x808080, 0xc0c0c0,
  0x000000, 0x000000, 0xffffff,
];

export const DISPLAY_MODES = {
  vga: {
    ...COMMON,
    name: 'VGA',
    /* The driver's file, as the distribution's `SETUP.INF` names it; its
     * module is `DISPLAY` whichever it is. */
    driverFile: 'VGA.DRV',
    description: 'VGA, 640x480, 16 colours',
    provenance: RECORDED,

    width: 640,
    height: 480,

    // The physical size the driver claims, in millimetres.
    widthMillimetres: 208,
    heightMillimetres: 156,

    logicalPixelsX: 96,
    logicalPixelsY: 96,
    aspectX: 36,
    aspectY: 36,
    aspectXY: 51,

    /* Sixteen colours are four one-bit planes rather than four bits in a byte,
     * which anything building a bitmap by hand has to know.
     */
    bitsPerPixel: 1,
    planes: 4,
    colors: 16,

    /* The window and viewport extents of `MM_LOMETRIC`, `MM_HIMETRIC`,
     * `MM_LOENGLISH`, `MM_HIENGLISH` and `MM_TWIPS`, as window x and y,
     * viewport x and y: the driver's own. **Recorded** by `mapmode`.
     */
    mappingExtents: [
      [2080, 1560, 640, -480],
      [20800, 15600, 640, -480],
      [325, 325, 254, -254],
      [1625, 1625, 127, -127],
      [2340, 2340, 127, -127],
    ],

    metrics: VGA_METRICS,
    sysColors: VGA_COLORS,
    metricsByIndex: VGA_BY_INDEX,
  },

  svga: {
    ...COMMON,
    name: 'Super VGA',
    driverFile: 'SUPERVGA.DRV',
    description: 'Super VGA, 800x600, 16 colours',
    provenance: RECORDED,

    width: 800,
    height: 600,
    widthMillimetres: 208,
    heightMillimetres: 156,

    logicalPixelsX: 96,
    logicalPixelsY: 96,
    aspectX: 36,
    aspectY: 36,
    aspectXY: 51,

    bitsPerPixel: 1,
    planes: 4,
    colors: 16,

    /* The window and viewport extents of `MM_LOMETRIC`, `MM_HIMETRIC`,
     * `MM_LOENGLISH`, `MM_HIENGLISH` and `MM_TWIPS`, as window x and y,
     * viewport x and y: the driver's own. **Recorded** by `mapmode`.
     */
    mappingExtents: [
      [2080, 1560, 800, -600],
      [20800, 15600, 800, -600],
      [325, 325, 318, -318],
      [1625, 1625, 159, -159],
      [2340, 2340, 159, -159],
    ],

    metrics: VGA_METRICS,
    sysColors: VGA_COLORS,
    metricsByIndex: VGA_BY_INDEX,
  },

  ega: {
    ...COMMON,
    name: 'EGA',
    driverFile: 'EGA.DRV',
    description: 'EGA, 640x350, 16 colours',
    provenance: RECORDED,

    width: 640,
    height: 350,
    widthMillimetres: 240,
    heightMillimetres: 175,

    /* EGA pixels are not square: ninety-six dots per inch across and
     * seventy-two down. Anything laying out in logical units has to know, and
     * a program that assumes otherwise draws ovals.
     */
    logicalPixelsX: 96,
    logicalPixelsY: 72,
    aspectX: 38,
    aspectY: 48,
    aspectXY: 61,

    bitsPerPixel: 1,
    planes: 4,
    colors: 16,

    /* Its colours are its driver's, which are not quite the VGA's. See
     * `DevicePalette.EGA`. */
    palette: 'ega',

    /* The window and viewport extents of `MM_LOMETRIC`, `MM_HIMETRIC`,
     * `MM_LOENGLISH`, `MM_HIENGLISH` and `MM_TWIPS`, as window x and y,
     * viewport x and y: the driver's own. **Recorded** by `mapmode`.
     */
    mappingExtents: [
      [2400, 1750, 640, -350],
      [24000, 17500, 640, -350],
      [375, 250, 254, -127],
      [3750, 2500, 254, -127],
      [5400, 3600, 254, -127],
    ],

    metrics: EGA_METRICS,
    sysColors: EGA_COLORS,
    metricsByIndex: EGA_BY_INDEX,
  },

  hercules: {
    ...COMMON,
    name: 'Hercules',
    driverFile: 'HERCULES.DRV',
    description: 'Hercules, 720x348, monochrome',
    provenance: RECORDED,

    width: 720,
    height: 348,
    widthMillimetres: 225,
    heightMillimetres: 145,

    /* The same two resolutions an EGA reports -- ninety-six across and
     * seventy-two down -- and a wholly different pixel: eleven wide to sixteen
     * tall where an EGA's is thirty-eight to forty-eight. The two numbers say
     * opposite things here, which is what makes this display worth recording:
     * every rule settled on a VGA and an EGA had those two agreeing in
     * direction, and here they do not.
     */
    logicalPixelsX: 96,
    logicalPixelsY: 72,
    aspectX: 11,
    aspectY: 16,
    aspectXY: 19,

    bitsPerPixel: 1,
    planes: 1,
    colors: 2,

    /* The Hercules driver is a different one and says so. **Recorded**: it
     * offers fewer raster operations than the colour drivers, no clipping of
     * its own, a brush count rather than "as many as you like", and ten pens
     * where they have eighty.
     */
    rasterCaps: 665,
    textCaps: 8196,

    /* No mouse trails: **recorded** by `escapes`. */
    escapes: { 5: 1, 8: 1 },
    mouseTrails: 0,
    clipCaps: 0,
    numBrushes: 77,
    numPens: 10,

    /* And it draws a line differently, which none of the capability bits say.
     * The three colour drivers break a tie toward the smaller y; this one
     * breaks it by the slope. **Recorded**: 192 of 740 lines land elsewhere
     * than they do on a VGA, and the rule that predicts all 740 is in
     * `BitmapContext.stroke`.
     */
    lineTie: 'slope',

    /* And it draws the emboldening overhang where the colour drivers drop it.
     * **Recorded**: of the 6,046 cells of the glyph sweep, the two displays
     * that report ninety-six by seventy-two disagree about ten, every one of
     * them bold, and in every one this display has exactly one more pixel at
     * the right-hand end of a row. See `Surface.fillText`.
     */
    boldOverhang: 'always',

    /* The window and viewport extents of `MM_LOMETRIC`, `MM_HIMETRIC`,
     * `MM_LOENGLISH`, `MM_HIENGLISH` and `MM_TWIPS`, as window x and y,
     * viewport x and y: the driver's own. **Recorded** by `mapmode`.
     */
    mappingExtents: [
      [2250, 1450, 720, -348],
      [22500, 14500, 720, -348],
      [1000, 725, 813, -442],
      [10000, 3625, 813, -221],
      [3240, 5220, 183, -221],
    ],

    metrics: EGA_METRICS,
    sysColors: HERCULES_COLORS,
    metricsByIndex: HERCULES_BY_INDEX,
  },

  vga256: {
    ...COMMON,
    name: 'Super VGA 256',
    /* Microsoft's Super VGA driver from the Windows Driver Library, on a
     * Tseng ET4000: the profile `8et4480` of its own `OEMSETUP.INF`. */
    driverFile: 'SVGA256.DRV',
    description: 'Super VGA, 640x480, 256 colours',
    provenance: RECORDED,

    /* What differs from the sixteen-colour drivers, **recorded** by
     * `devcaps`: `NUMCOLORS` is the twenty reserved colours, not the
     * palette's 256; `RASTERCAPS` adds `RC_PALETTE`, `RC_STRETCHBLT`
     * and `RC_STRETCHDIB` and drops `RC_SAVEBITMAP`; `TEXTCAPS` drops
     * `TC_EA_DOUBLE`; and the driver counts 100 pens. */
    numColors: 20,
    rasterCaps: 28569,
    textCaps: 8196,
    numPens: 100,

    width: 640,
    height: 480,
    widthMillimetres: 208,
    heightMillimetres: 156,

    logicalPixelsX: 96,
    logicalPixelsY: 96,
    aspectX: 36,
    aspectY: 36,
    aspectXY: 51,

    /* A packed byte per pixel rather than planes, and a palette to go with
     * it: twenty reserved entries, a palette of 256 and 18 bits of colour
     * resolution, where a sixteen colour driver reports none of them. */
    bitsPerPixel: 8,
    planes: 1,
    colors: 256,
    numReserved: 20,
    sizePalette: 256,
    colorRes: 18,

    /* What the screen shows of the first ten palette entries: a component
     * of exactly 80h goes into the DAC as C0h. **Read out** of SVGA256.DRV's
     * palette routine (seg5 `0278`: below
     * index 10, `cmp al,80h` / `mov al,0C0h` before `shr al,2`), and
     * **recorded** by `palshot`, a swatch of each static colour taken from
     * the screen: the six dark colours show at C0h, the grey of 80h at 248
     * as its entry. Only what is shown: `GetSystemPaletteEntries`,
     * `GetPixel` and the rest answer the entries. */
    brightLowStatics: 10,

    /* The extents of the fixed mapping modes: the VGA's, not recorded. */
    mappingExtents: [
      [2080, 1560, 640, -480],
      [20800, 15600, 640, -480],
      [325, 325, 254, -254],
      [1625, 1625, 127, -127],
      [2340, 2340, 127, -127],
    ],

    metrics: VGA_METRICS,
    sysColors: VGA_COLORS,
    metricsByIndex: VGA_BY_INDEX,
  },

  /* IBM's 8514/a, Windows 3.1's own `8514.DRV`, as Setup's "8514/a"
   * installs it: 1024x768, large fonts. **Read out** of the driver, as it
   * answers on a card with a megabyte, in protected mode on a processor
   * above the 286, which is what winbox.js is (`GetWinFlags`, 419h).
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
   * `PC_SCANLINE`. */
  8514: {
    ...COMMON,
    name: '8514/a',
    driverFile: '8514.DRV',
    description: '8514/a, 1024x768, 256 colours, large fonts',
    provenance: READ_OUT,

    numColors: 20,
    rasterCaps: 0x07d9,
    textCaps: 0x2004,
    lineCaps: 0x02,
    polygonalCaps: 0x8a,
    numPens: 20,

    /* `QUERYESCSUPPORT` answers 1 for `GETCOLORTABLE` and itself, and
     * nought for the rest, `MOUSETRAILS` among them (seg1 `1b1c`). */
    escapes: { 5: 1, 8: 1 },
    mouseTrails: 0,

    width: 1024,
    height: 768,
    widthMillimetres: 280,
    heightMillimetres: 210,

    logicalPixelsX: 120,
    logicalPixelsY: 120,
    aspectX: 10,
    aspectY: 10,
    aspectXY: 14,

    bitsPerPixel: 8,
    planes: 1,
    colors: 256,
    numReserved: 20,
    sizePalette: 256,
    colorRes: 18,

    /* Its twenty static colours, which are the Super VGA's but for the
     * tenth, `a4c8f0` for `a6caf0` (data `3B8h`). See
     * `DevicePalette.TWO_FIFTY_SIX_IBM`. */
    palette: '8514',

    /* The extents of the fixed mapping modes: the template's. */
    mappingExtents: [
      [2800, 2100, 1024, -768],
      [28000, 21000, 1024, -768],
      [4375, 4375, 4064, -4064],
      [21875, 21875, 2032, -2032],
      [7875, 7875, 508, -508],
    ],

    metrics: XGA_METRICS,
    sysColors: XGA_COLORS,
    metricsByIndex: XGA_BY_INDEX,
  },

  /* IBM's XGA, Windows 3.1's own `XGA.DRV`, as Setup's "XGA (Large fonts)"
   * installs it. **Read out** of the driver, as it answers on a card with a
   * megabyte and a monitor that takes 1024x768, in protected mode on a 486,
   * which is what winbox.js is (`GetWinFlags`, 419h).
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
   * are. */
  xga256: {
    ...COMMON,
    name: 'XGA 256',
    driverFile: 'XGA.DRV',
    description: 'XGA, 1024x768, 256 colours, large fonts',
    provenance: READ_OUT,

    numColors: 20,
    rasterCaps: 0x03d9,
    textCaps: 0x2204,
    lineCaps: 0x02,
    polygonalCaps: 0x8a,
    numPens: 120,

    /* `QUERYESCSUPPORT` answers 1 for `GETCOLORTABLE` and itself, nought
     * for the rest (seg1 `1316`). */
    escapes: { 5: 1, 8: 1 },
    mouseTrails: 0,

    width: 1024,
    height: 768,
    widthMillimetres: 280,
    heightMillimetres: 210,

    logicalPixelsX: 120,
    logicalPixelsY: 120,
    aspectX: 10,
    aspectY: 10,
    aspectXY: 14,

    bitsPerPixel: 8,
    planes: 1,
    colors: 256,
    numReserved: 20,
    sizePalette: 256,
    colorRes: 18,

    /* The 8514/a's twenty static colours (data `1BD9h`). */
    palette: '8514',

    /* The template's windows; every viewport the monitor's 92 pixels an
     * inch. */
    mappingExtents: [
      [254, 254, 92, -92],
      [2540, 2540, 92, -92],
      [100, 100, 92, -92],
      [1000, 1000, 92, -92],
      [1440, 1440, 92, -92],
    ],

    metrics: XGA_METRICS,
    sysColors: XGA_COLORS,
    metricsByIndex: XGA_BY_INDEX,
  },
};

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
