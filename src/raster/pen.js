"use strict";

export class Pen {
    constructor(color, width, style) {
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
