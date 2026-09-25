/**
 * Probes whose answers belong to a display driver rather than to Windows.
 *
 * `GetDeviceCaps` obviously, but the text metrics too: which stock fonts get
 * installed depends on the resolution, so a VGA reading of them says nothing
 * about an EGA. These get one fixture per display; everything else gets one.
 *
 * `maxwidth` is here because the sizes are the point of it. A height asked for
 * on an EGA is realised at a different pixel size than on a VGA, so the same
 * sweep run on both is two sets of sizes rather than one repeated -- 572 of its
 * 891 metric records differ between them -- and the maximum width is the one
 * thing left that no rule explains.
 */
export const PER_DISPLAY = new Set([
  'devcaps',
  'maxwidth',
  'charscal',
  'glyphs',
  'font',
  'hinting',
  'lines',
  'plotter',

  /* Stock glyphs swept in size, which is a question about the pixel as much as
   * about the size. Without this the EGA run overwrites the VGA one and the
   * two look like the same probe disagreeing with itself.
   */
  'stemsize',
  'stemwide',
  'stemedge',
  'stemstyl',
  'plotbig',
  'symbig',
  'strikbig',
  'rules',
  'textbk',
  'textalin',
  'textxtra',
  'scalemem',
  'scalepts',
  'tiepick',
  'symadv',
  'dipcell',
  'tiewide',
  'strikout',
  'groundw',
  'groundbx',
  'groundsc',
  'extout',
  'groundrn',
  'clipedge',
]);

/** The fixture `record.mjs` writes for a probe recorded on a display. */
export const fixtureFor = (probe, display) =>
  PER_DISPLAY.has(probe) ? `${probe}-${display}` : probe;
