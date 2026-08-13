"use strict";

export class Pen {
    declare _color: any;
    declare _style: any;
    declare _width: any;
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
