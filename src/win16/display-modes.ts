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
 * The three marked `recorded` were read out of real Windows 3.1 running each
 * driver, and live in `oracle/fixtures/devcaps-*.json`. Every field below
 * matches those recordings.
 *
 * The 256-colour modes are marked `modelled`, which is a weaker claim and
 * deliberately a visible one. Every 256-colour driver Windows 3.1 ships is for
 * a specific card -- Video 7, XGA, 8514/a -- and DOSBox emulates none of them,
 * so there is currently nothing to record against. Their resolutions, colour
 * depths and dot pitches come from the driver descriptions in the
 * distribution's own `SETUP.INF`; the capability bits are carried over from the
 * recorded drivers, which is a guess that happens to be well founded, since
 * those bits were identical across all three of them.
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

/** A driver whose numbers are assembled from documentation. */
export const MODELLED = 'modelled';

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
 * probe recorded. The Super VGA's are the VGA's; the two
 * 256-colour modes are not recorded and take the VGA's.
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
 * The two 256-colour modes are not recorded and take the VGA's.
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

  xga256: {
    ...COMMON,
    name: 'XGA 256',
    driverFile: '8514.DRV',
    description: '8514/a, 1024x768, 256 colours',
    provenance: MODELLED,

    width: 1024,
    height: 768,
    widthMillimetres: 208,
    heightMillimetres: 156,

    // The large-font driver, which is what 120 dots per inch means here.
    logicalPixelsX: 120,
    logicalPixelsY: 120,
    aspectX: 36,
    aspectY: 36,
    aspectXY: 51,

    bitsPerPixel: 8,
    planes: 1,
    colors: 256,
    numReserved: 20,
    sizePalette: 256,
    colorRes: 18,

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
