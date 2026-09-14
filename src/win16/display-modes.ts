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

export const DISPLAY_MODES = {
  vga: {
    ...COMMON,
    name: 'VGA',
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

    metrics: VGA_METRICS,
  },

  svga: {
    ...COMMON,
    name: 'Super VGA',
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

    metrics: VGA_METRICS,
  },

  ega: {
    ...COMMON,
    name: 'EGA',
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

    metrics: EGA_METRICS,
  },

  hercules: {
    ...COMMON,
    name: 'Hercules',
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

    metrics: EGA_METRICS,
  },

  vga256: {
    ...COMMON,
    name: 'VGA 256',
    description: 'Video 7, 640x480, 256 colours',
    provenance: MODELLED,

    width: 640,
    height: 480,
    widthMillimetres: 208,
    heightMillimetres: 156,

    logicalPixelsX: 96,
    logicalPixelsY: 96,
    aspectX: 36,
    aspectY: 36,
    aspectXY: 51,

    /* A packed byte per pixel rather than planes, and a palette to go with it:
     * a 256 colour driver reports twenty reserved entries and eight bits of
     * colour resolution where a sixteen colour one reports none of either.
     */
    bitsPerPixel: 8,
    planes: 1,
    colors: 256,
    numReserved: 20,
    sizePalette: 256,
    colorRes: 18,

    metrics: VGA_METRICS,
  },

  xga256: {
    ...COMMON,
    name: 'XGA 256',
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

    metrics: VGA_METRICS,
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
