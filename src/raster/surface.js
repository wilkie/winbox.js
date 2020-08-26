"use strict";

import { Brush } from './brush.js';
import { Pen } from './pen.js';
import { Color } from './color.js';
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
        this.brush = new Brush(new Color(0xff, 0xff, 0xff));
        this.pen = new Pen(new Color(0x00, 0x00, 0x00));
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

    strokeRect(x, y, width, height) {
        this.context.strokeStyle = this.brush.color.css;
        this.context.strokeRect(x, y, width, height);
    }

    fillText(x, y, text) {
        // TODO: backcolor
        console.log(this._font);
        if (this._font instanceof BitmapFont) {
            // A bitmap font
            this._font.draw(this.context, x, y, text);
        }
        else {
            // Normal text draw
            console.log("DRAW?", text, x, y);
            this.context.font = this._font;

            this.context.textBaseline = "top";
            let measured = this.context.measureText(text);
            console.log(measured);
            let textWidth = measured.actualBoundingBoxRight +
                            measured.actualBoundingBoxLeft;
            let textHeight = measured.actualBoundingBoxDescent -
                             measured.actualBoundingBoxAscent;
            this.context.fillStyle = "white";
            this.context.fillRect(x, y, textWidth, textHeight);

            this.context.fillStyle = "black";
            this.context.fillText(text, x, y);
        }
    }
}
