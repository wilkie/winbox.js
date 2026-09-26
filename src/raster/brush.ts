'use strict';

/** A brush's pattern: eight by eight pixels as indices of their own palette. */
export interface BrushPattern {
  depth: number;
  palette: any;
  indices: Uint8Array;
}

export class Brush {
  declare _color: any;

  /** A pattern brush's pixels, which it keeps from its bitmap. */
  pattern: BrushPattern | null = null;

  /** The bitmap a pattern brush was made from, as `GetObject` answers it. */
  bitmap = 0;

  /**
   * Where a pattern brush's pattern starts, taken from the device context's
   * brush origin when the brush is first selected, and kept until
   * `UnrealizeObject`.
   */
  origin: { x: number; y: number } | null = null;

  /** The stock object a device context's own first brush stands for. */
  stock: number | null = null;

  constructor(color) {
    this._color = color;
  }

  get color() {
    return this._color;
  }
}
