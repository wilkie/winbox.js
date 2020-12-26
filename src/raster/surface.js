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
        this.brush = new Brush(new Color(0xff, 0xff, 0xff, 0xff));
        this.pen = new Pen(new Color(0x00, 0x00, 0x00, 0xff));
        this.backcolor = new Color(0x00, 0x00, 0x00, 0xff);
        this.forecolor = new Color(0xff, 0xff, 0xff, 0xff);

        // We start stale
        this._stale = true;
    }

    update() {
        if (this.width != 0 && this.height != 0) {
            this.context.putImageData(this.data, 0, 0);
        }
        this.dirty = false;
    }

    get dirty() {
        return this._dirty;
    }

    set dirty(value) {
        this._dirty = value;
    }

    get data() {
        // If we are stale, pull the image data
        if (this._stale) {
            if (this.width != 0 && this.height != 0) {
                this._data = this.context.getImageData(0, 0, this.width, this.height);
            }
            this._view = new DataView(this._data.data.buffer);
            this._stale = false;
        }

        return this._data;
    }

    get view() {
        // Ensure that the view is created
        this.data;

        // Return the view
        return this._view;
    }

    get width() {
        return parseInt(this._canvas.getAttribute('width'));
    }

    get height() {
        return parseInt(this._canvas.getAttribute('height'));
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
    
    get backcolor() {
        return this._backcolor;
    }

    set backcolor(value) {
        this._backcolor = value;
    }

    get pen() {
        return this._pen;
    }

    set pen(value) {
        this._pen = value;
        this.context.strokeStyle = value.color.css;
    }
    
    get forecolor() {
        return this._forecolor;
    }

    set forecolor(value) {
        this._forecolor = value;
    }

    get font() {
        return this._font;
    }

    set font(value) {
        this._font = value;
    }

    get bitmap() {
        return this._bitmap;
    }

    set bitmap(value) {
        this._bitmap = value;

        // This defines the canvas size
        this._canvas.setAttribute('width', value.width);
        this._canvas.setAttribute('height', value.height);

        // Tell the bitmap that it should update this surface
        value.surface = this;
    }

    fillRect(x, y, width, height) {
        //this.context.fillStyle = this.brush.color.css;
        //this.context.fillRect(x, y, width, height);
        // TODO: improve performance of the ditherer and enable it
        //this._ditherer.fill(this.context, x, y, width, height, this._brush.color.value);
        this._stale = true;

        // Set the actual bitmap bits
        if (this._bitmap) {
            this._bitmap.fill(x, y, width, height, this.brush.color);
        }
    }

    strokeRect(x, y, width, height) {
        this.context.strokeStyle = this.pen.color.css;
        this.context.strokeRect(x, y, width + 0.5, height + 0.5);
        this._stale = true;
    }

    fillText(x, y, text) {
        // TODO: backcolor
        if (this._font instanceof BitmapFont) {
            // A bitmap font
            this._font.fontFor(12).draw(this.context, x, y, text);
        }
        else {
            // Normal text draw
            this.context.font = this._font;

            this.context.textBaseline = "top";
            this.context.fillStyle = "black";
            this.context.fillText(text, x, y);
        }
        this._stale = true;
    }

    /**
     * Returns the dimensions of the given string using the current font.
     *
     * @param {String} text - The text to measure.
     */
    measureText(text) {
        if (this._font instanceof BitmapFont) {
            // A bitmap font
            return this._font.fontFor(12).measure(text);
        }
        else {
            // Normal text draw
            this.context.font = this._font;

            this.context.textBaseline = "top";
            let measured = this.context.measureText(text);
            let textWidth = measured.actualBoundingBoxRight +
                            measured.actualBoundingBoxLeft;
            let textHeight = measured.actualBoundingBoxDescent -
                             measured.actualBoundingBoxAscent;

            return {
                width: textWidth,
                height: textHeight
            };
        }
    }
}
