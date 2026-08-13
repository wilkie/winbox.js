'use strict';

export class Brush {
  declare _color: any;
  constructor(color) {
    this._color = color;
  }

  get color() {
    return this._color;
  }
}
