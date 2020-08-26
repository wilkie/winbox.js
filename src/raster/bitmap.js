"use strict";

/**
 * Represents a bitmap of color values.
 */
let x = 0;
let y = 0;
let nextY = 0;
export class Bitmap {
    constructor(width, height, bpp, format, view, options = {}) {
        this._width = width;
        this._height = height;
        this._bpp = bpp;
        this._format = format;
        this._view = view;
        this._options = options;

        // I'm gonna render it. don't stop me
        /*
        if (bpp == 32) {
            var canvas = document.createElement("canvas");
            canvas.setAttribute('width', width);
            canvas.setAttribute('height', height);

            if (x + width > window.innerWidth) {
                x = 0;
                y = nextY;
                nextY = 0;
            }

            if (y + height > nextY) {
                nextY = y + height;
            }

            canvas.style.position = "absolute";
            canvas.style.left = x + "px";
            canvas.style.top = y + "px";
            x += width;

            let context = canvas.getContext('2d');
            let imgData = context.getImageData(0, 0, width, height);
            let pixels = imgData.data;
            for (let i = 0; i < pixels.byteLength; i++) {
                pixels[i] = view.getUint8(i);
            }
            context.putImageData(imgData, 0, 0);

            document.body.appendChild(canvas);
        }
        else {
            //if (width == 25 && height == 31) {
                this.to32bppARGB();
            //}
        }*/
    }

    get options() {
        return this._options;
    }

    get width() {
        return this._width;
    }

    get height() {
        return this._height;
    }

    get bpp() {
        return this._bpp;
    }

    get format() {
        return this._format;
    }

    get data() {
        return this.view.buffer;
    }

    get view() {
        return this._view;
    }

    to32bppARGB() {
        let bpp = this.bpp;
        let width = this.width;
        let height = this.height;
        let view = this.view;

        let colors = 1 << bpp;

        let offset = 0;
        let palette = [];
        let bytesPerRead = 4;
        if (colors <= 256) {
            bytesPerRead = 1;

            // Palette is the first thing in the data stream.
            // 32-bit color values for each color
            for (let i = 0; i < colors; i++) {
                palette.push(view.getUint32(offset, true));
                offset += 4;
            }
        }

        // Convert ABGR to ARGB
        if (this.format == Bitmap.ABGR) {
            for (let i = 0; i < palette.length; i++) {
                let clr = palette[i];
                clr = ((clr >> 16) & 0xff) | (clr & 0xff00) | ((clr & 0xff) << 16) | 0xff000000;
                palette[i] = clr;
            }
        }

        // Read the bitmap data that follows

        // Each row has to be a multiple of 4 bytes
        let bpRow = bpp * width;
        bpRow = (bpRow + (8 - 1)) & ~(8 - 1);

        let widthBytes = ((bpRow >> 3) + (4 - 1)) & ~(4 - 1);

        // Therefore the size of the bitmap itself is:
        let size = widthBytes * height;
        
        // Allocate the bitmap data
        let bitmapData = new Uint32Array(width * height);

        let read = view.getUint32.bind(view);
        if (bpp == 1) {
            read = (offset) => {
                let b = view.getUint8(offset);
                return [
                    palette[(b >> 1) & 0x1], palette[b & 0x1],
                    palette[(b >> 3) & 0x1], palette[(b >> 2) & 0x1],
                    palette[(b >> 5) & 0x1], palette[(b >> 4) & 0x1],
                    palette[(b >> 7) & 0x1], palette[(b >> 6) & 0x1],
                ];
            };
        }
        else if (bpp == 2) {
            read = (offset) => {
                let b = view.getUint8(offset);
                return [
                    palette[(b >> 2) & 0x3], palette[b & 0x3],
                    palette[(b >> 6) & 0x3], palette[(b >> 4) & 0x3]
                ];
            };
        }
        else if (bpp == 4) {
            read = (offset) => {
                let b = view.getUint8(offset);
                return [palette[(b >> 4) & 0xf], palette[b & 0xf]];
            };
        }
        else if (bpp == 8) {
            read = (offset) => {
                let b = view.getUint8(offset);
                return palette[b];
            };
        }

        // The bitmap data is stored from the bottom up
        for (let y = height - 1; y >= 0; y--) {
            let initialOffset = offset;
            for (let x = 0; x < width; ) {
                let pixels = read(offset, true);
                offset += bytesPerRead;

                pixels.forEach( (pixel) => {
                    if (x < width) {
                        bitmapData[(y * width) + x] = pixel;
                    }
                    x++;
                });
            }
            offset = initialOffset + widthBytes;
        }

        // The bitmap data is now in 32-bit ARGB form.
        // The Canvas element uses ABGR form.

        return new Bitmap(width, height, 32, Bitmap.ARGB, new DataView(bitmapData.buffer));
    }
}

Bitmap.ABGR = 0;
Bitmap.ARGB = 1;
