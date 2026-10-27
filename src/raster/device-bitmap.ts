'use strict';

import { Bitmap } from './bitmap.js';
import { DevicePalette } from './device-palette.js';
import { IndexedContext } from './indexed-context.js';

/**
 * A device-dependent bitmap: what `CreateBitmap`, `CreateCompatibleBitmap` and
 * `LoadBitmap` make, and what a memory device context draws into.
 *
 * One byte a pixel, holding an index into the palette for the bitmap's depth
 * -- black and white for a monochrome bitmap, the display's colours for any
 * other. There is one store: a memory device context's drawing, `BitBlt`,
 * `PatBlt`, `GetPixel` and the bits calls all work on these bytes, so nothing
 * drawn one way is missed by another. Colours are turned into indices when
 * they are drawn, as a display driver does, and back into colours only when
 * something asks for them.
 */
export class DeviceBitmap extends Bitmap {
  indices: Uint8Array;
  readonly devicePalette: DevicePalette;
  readonly context: IndexedContext;
  readonly depth: number;

  /** The one-by-one bitmap a new memory device context starts with. */
  placeholder = false;

  /** Whether it has been selected into a device context: until then the
   * driver's header GDI keeps for it points at no bits (`gdiobj`). */
  selected = false;

  /**
   * A bitmap made in a shape no device context takes -- planes and bits a
   * pixel that are neither monochrome nor the display's: the shape, and its
   * bytes as they were given, with no pixels (`patmono`).
   */
  shape: { planes: number; bits: number; bytes: Uint8Array } | null = null;

  constructor(
    width: number,
    height: number,
    depth: number,
    indices?: Uint8Array,
    palette = DevicePalette.forDepth(depth)
  ) {
    super(width, height, depth, Bitmap.RGBA, undefined, []);

    this.depth = depth;
    this.devicePalette = palette;
    this.indices = indices ?? new Uint8Array(Math.max(width * height, 0));
    this.context = new IndexedContext(width, height, this.indices, this.devicePalette);
  }

  /**
   * A view of `parent`'s pixels: `width` by `height` from `left, top`, drawn
   * only where `clip` allows. Nothing is copied; what is drawn through the
   * view is drawn on the parent, and marked there. This is a window's client
   * area on the screen.
   */
  static view(
    parent: DeviceBitmap,
    left: number,
    top: number,
    width: number,
    height: number,
    clip: ((x: number, y: number) => boolean) | null = null
  ) {
    const view = new DeviceBitmap(
      width,
      height,
      parent.depth,
      parent.indices,
      parent.devicePalette
    );
    const context = view.context;

    context.display = parent.context.display;
    context.base = top * parent.width + left;
    context.stride = parent.width;
    context.clip = clip;
    context.owner = parent.context;
    context.ownerX = left;
    context.ownerY = top;

    return view;
  }

  /**
   * A device context's view of all of `parent`'s pixels, its (0, 0) at
   * `origin` in them: as large as the window it is for, `width` by
   * `height`, from `corner`, but reaching every pixel of the parent, left
   * of and above nought too -- a window's device context in Windows'
   * terms, a view of the whole screen from its origin. What it draws is
   * kept to its region by its device context (`dcClip`), not by the view.
   */
  static screenView(
    parent: DeviceBitmap,
    corner: [number, number],
    width: number,
    height: number,
    origin: [number, number] = corner
  ) {
    const view = DeviceBitmap.view(parent, corner[0], corner[1], width, height);

    view.corner = corner;
    view.moveOrigin(origin[0], origin[1]);

    return view;
  }

  /** Where a screen view's window is on the screen, or `null` for any other bitmap. */
  corner: [number, number] | null = null;

  /** A screen view's (0, 0) moved to `x, y` of the screen: `SetDCOrg`. */
  moveOrigin(x: number, y: number) {
    const context = this.context;
    const parent = context.owner!;

    context.base = y * context.stride + x;
    context.ownerX = x;
    context.ownerY = y;
    context.reach = { left: -x, top: -y, right: parent.width - x, bottom: parent.height - y };
  }

  /** Whether this bitmap's pixels are another's. */
  get isView() {
    return this.context.owner !== null;
  }

  /**
   * Its pixels kept in `indices` from now on, `base` and `stride` placing
   * them as `IndexedContext`'s do: a WinG bitmap's are its bits in the
   * machine's memory, taken again when that memory moves.
   */
  rebind(indices: Uint8Array, base = this.context.base, stride = this.context.stride) {
    this.indices = indices;
    this.context.indices = indices;
    this.context.base = base;
    this.context.stride = stride;
  }

  /** Writes an index at a pixel, where the pixel exists and may be written. */
  put(x: number, y: number, index: number) {
    const at = this.context.address(x, y);

    if (
      at >= 0 &&
      (!this.context.clip || this.context.clip(x, y)) &&
      (!this.context.dcClip || this.context.dcClip(x, y))
    ) {
      this.indices[at] = index;
    }
  }

  /* A device bitmap's size is its own, whatever surface it is selected into. */
  get width() {
    return this._width;
  }

  get height() {
    return this._height;
  }

  get bpp() {
    return this.depth;
  }

  /** The index at a pixel, or `null` outside the bitmap. */
  indexAt(x: number, y: number) {
    const at = this.context.address(x, y);

    return at < 0 ? null : this.indices[at];
  }
}
