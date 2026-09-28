'use strict';

export class Pen {
  declare _color: any;
  declare _style: any;
  declare _width: any;

  /** The `LOGPEN` a pen was made from, as `GetObject` answers it. */
  logpen: { style: number; width: number; y: number; color: number } | null = null;
  constructor(color, width?, style?) {
    this._color = color;
    this._style = style;
    this._width = width;
  }

  get color() {
    return this._color;
  }

  get style() {
    return this._style;
  }

  get width() {
    return this._width;
  }
}
