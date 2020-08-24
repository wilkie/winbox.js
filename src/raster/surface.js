"use strict";

import { Ditherer } from './ditherer.js';
import { BitmapFont } from './bitmap-font.js';

/**
 * This offers a drawing context.
 */
export class Surface {
    constructor(canvas) {
        this._canvas = canvas;
        this._ditherer = new Ditherer();

        // TODO: what are the default pen/brush?
    }

    get canvas() {
        return this._canvas;
    }

    get context() {
        if (!this._context) {
            this._context = this.canvas.getContext('2d');
        }

        return this._context;
    }

    get brush() {
        return this._brush;
    }

    set brush(value) {
        this._brush = value;
        this.context.fillStyle = value.color.css;
    }

    get pen() {
        return this._pen;
    }

    set pen(value) {
        this._pen = value;
        this.context.strokeStyle = value.color.css;
    }

    get font() {
        return this._font;
    }

    set font(value) {
        this._font = value;
    }

    fillRect(x, y, width, height) {
        this._ditherer.fill(this.context, x, y, width, height, this._brush.color.value);
    }

    drawText(x, y, text) {
        console.log(this._font);
        if (this._font instanceof BitmapFont) {
            // A bitmap font
            this._font.draw(this.context, x, y, text);
        }
        else {
            // Normal text draw
        }
    }
}
