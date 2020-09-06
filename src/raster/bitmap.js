"use strict";

import { Color } from './color.js';
import { Palette } from './palette.js';

/**
 * Represents a bitmap of color values.
 */
let x = 0;
let y = 0;
let nextY = 0;

/**
 * Represents a graphic.
 *
 * These are represented by a format and a bpp which define how the pixel data
 * is actually stored. Some Bitmap objects have an internal representation of
 * the color data that is native to the actual device, generally a 32-bit per
 * pixel format that can be realized on the actual screen.
 *
 * They maintain their given representation such that the data is available to
 * applications running in the emulated environment. The bitmaps that are
 * attached to items that are realized on the screen maintain the device
 * specific representation as well.
 */
export class Bitmap {
    /**
     * Creates a Bitmap object with the given properties, palette, and data.
     */
    constructor(width, height, bpp, format, view, palette, options = {}) {
        this._width = width;
        this._height = height;
        this._bpp = bpp;
        this._format = format;
        this._view = view;
        this._options = options;

        if (palette[0] instanceof Array) {
            palette = palette.map( (x) => {
                if (format == Bitmap.RGBA) {
                    // The palette is an RGBA 32-bit value.
                    return (x[0] << 24) | (x[1] << 16) | (x[2] << 8) | 0x000000ff;
                }
                else {
                    // This one is ABGR 32-bit.
                    return (x[0]) | (x[1] << 8) | (x[2] << 16) | 0xff000000;
                }
            });
        }

        this._palette = palette;

        // I'm gonna render it. don't stop me
        if (bpp == 32 && format == Bitmap.RGBA) {
            //this.render();
        }
        else if (bpp == 8) {
            //if (width == 25 && height == 31) {
            //this.convert(32);
            //}
        }

        // Whether or not we also maintain an offscreen copy.
        // This will also get modified by operations.
        // The point of the offscreen copy is to maintain a version that we
        // can render to the actual, real screen. Yanno, in real life.
        if (this._options.offscreen) {
            // Allocate the offscreen bitmap data
            let offscreenData = new Uint8Array(width * height * 4);
            let offscreenView = new DataView(offscreenData.buffer);

            // Create the bitmap
            this._offscreen = new Bitmap(width, height, 32, Bitmap.RGBA, offscreenView, palette)
        }
    }

    render() {
        if (this.bpp != 32) {
            this.convert(32).render();
            return;
        }
        let canvas = this._canvas;
        if (!this._canvas) {
            canvas = document.createElement("canvas");
            canvas.setAttribute('width', this.width);
            canvas.setAttribute('height', this.height);
            document.body.appendChild(canvas);
            this._canvas = canvas;

            if (x + this.width > window.innerWidth) {
                x = 0;
                y = nextY;
                nextY = 0;
            }

            if (y + this.height > nextY) {
                nextY = y + this.height;
            }

            canvas.style.position = "absolute";
            canvas.style.left = x + "px";
            canvas.style.top = y + "px";
            x += this.width;
        }

        let context = canvas.getContext('2d');
        let imgData = context.getImageData(0, 0, this.width, this.height);
        let pixels = imgData.data;
        for (let i = 0; i < pixels.byteLength; i++) {
            pixels[i] = this.view.getUint8(i);
        }
        context.putImageData(imgData, 0, 0);
    }

    get options() {
        return this._options;
    }

    /**
     * Retrieves the offscreen bitmap, if it exists.
     */
    get offscreen() {
        return this._offscreen;
    }

    /**
     * Establishes a Surface as the...
     */
    set surface(value) {
        this._surface = value;
    }

    get surface() {
        return this._surface;
    }

    get width() {
        return this._width;
    }

    get widthBytes() {
        let bpRow = this.bpp * this.width;
        bpRow = (bpRow + (8 - 1)) & ~(8 - 1);
        return ((bpRow >> 3) + (4 - 1)) & ~(4 - 1);
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

    get palette() {
        return this._palette;
    }

    /**
     * Performs the given operation using the given source bitmap.
     *
     * Optionally inverts the source signal before performing the operation.
     */
    blit(operation, destX, destY, destWidth, destHeight, source, srcX, srcY, srcWidth, srcHeight, invert = false) {
        // TODO: stretch operation when destWidth != srcWidth, etc
        // Determine the operation we wish to perform on each pixel pair
        let opFunc = null;
        if (operation == Bitmap.OPERATIONS.OR) {
            opFunc = (a, b) => { a | b };
        }
        else if (operation == Bitmap.OPERATIONS.AND) {
            opFunc = (a, b) => { a & b };
        }
        else if (operation == Bitmap.OPERATIONS.XOR) {
            opFunc = (a, b) => { a ^ b };
        }
        else if (operation == Bitmap.OPERATIONS.COPY) {
            // No operation (d = s or d = ~s)
        }
        else {
            return false;
        }

        // Get the initial byte offsets to the first line for each bitmap
        let destOffset = destY * this.widthBytes;
        let srcOffset = -1;
        let srcBPP = 8;
        let clr = 0;
        if (source instanceof Bitmap) {
            srcOffset = srcY * source.widthBytes;
            srcBPP = source.bpp;
        }
        else {
            // Source is a solid color
            clr = (source.value >> 8);
            srcBPP = 32;

            if (invert) {
                s = ~s;
                invert = false;
            }
        }

        // For each line in the source bitmap
        for (let y = 0; y < srcHeight; y++) {
            // For every pixel in the source bitmap
            for (let dX = destX, sX = srcX; dX < destX + srcWidth; dX++, sX++) {
                // Determine the source value (s)
                let s = 0;
                if (source instanceof Color) {
                    s = clr;
                }
                else if (srcBPP == 1) {
                    let offset = srcOffset + ((sX / 8) >>> 0);
                    if (offset >= 0) {
                        s = source.view.getUint8(offset);
                        s = s >> (7 - (sX % 8));
                    }
                }
                else if (srcBPP == 8) {
                    let offset = srcOffset + sX;
                    if (offset >= 0) {
                        s = source.view.getUint8(offset);
                    }
                }
                else if (srcBPP == 32) {
                    let offset = srcOffset + sX * 4;
                    if (offset >= 0) {
                        s = source.view.getUint32(offset);
                    }
                }

                // Invert the source signal (optionally)
                if (invert) {
                    s = (~s) & ((1 << source.bpp) - 1);
                }

                // Retrieve the current destination pixel color (d)
                // Convert source to destination color depth
                let d = 0;
                let cur = 0;
                if (this.bpp == 1) {
                    // TODO: compare against background color (brush color)
                    if (s == 0x0) {
                        s = 1;
                    }
                    else {
                        s = 0;
                    }

                    s = s << (7 - (dX % 8));

                    // Get current pixel value (if performing an operation)
                    let offset = destOffset + ((dX / 8) >>> 0);
                    if (offset < 0 || offset >= this.view.byteLength) {
                        continue;
                    }

                    cur = this.view.getUint8(offset);
                    if (opFunc) {
                        let position = 1 << (7 - (dX % 8));
                        d = cur & position;
                    }
                }
                else if (this.bpp == 8) {
                    // Retrieve the current destination pixel (if necessary)
                    let offset = destOffset + dX;
                    if (offset < 0 || offset >= this.view.byteLength) {
                        continue;
                    }

                    if (opFunc) {
                        d = this.view.getUint8(offset);
                    }
                }
                else if (this.bpp == 32) {
                    // Resolve the source palette, if needed
                    if (source.bpp < 32) {
                        s = source.palette[s];
                    }

                    // Retrieve the current destination pixel (if necessary)
                    let offset = destOffset + dX * 4;
                    if (offset < 0 || offset >= this.view.byteLength) {
                        continue;
                    }

                    if (opFunc) {
                        d = this.view.getUint32(offset);
                    }
                }

                // Perform operation
                if (opFunc) {
                    d = opFunc(s, d);
                }
                else {
                    d = s;
                }

                // Set value
                if (this.bpp == 1) {
                    let position = 1 << (7 - (dX % 8));
                    if (d) {
                        cur |= position;
                    }
                    else {
                        cur &= (~position) & 0xff;
                    }
                    this.view.setUint8(destOffset + ((dX / 8) >>> 0), cur);
                }
                else if (this.bpp == 8) {
                    this.view.setUint8(destOffset + dX, d);
                }
                else if (this.bpp == 32) {
                    this.view.setUint32(destOffset + (dX * 4), d);
                }

                if (this._surface) {
                    if (this.bpp < 32) {
                        d = this.palette[d];
                    }

                    // Set the appropriate canvas bits
                    this._surface.view.setUint32((y + destY) * this._surface.width * 4 + dX * 4, d);
                }
            }

            // Move to next line
            destOffset += this.widthBytes;
            if (srcOffset >= 0) {
                srcOffset += source.widthBytes;
            }
        }

        if (this._surface) {
            this._surface.update();
        }
    }

    /**
     * Converts this bitmap to the given color depth using the provided palette.
     *
     * If no palette is provided, it will use the default 256-color palette.
     */
    convert(bpp, palette, format) {
        palette = palette || Palette.PALETTEWIN256;
        format = format || this.format;

        let width = this.width;
        let height = this.height;
        let view = this.view;
        let fromPalette = this.palette;
        let realPalette = new Palette(palette);

        let targetbpRow = bpp * width;
        targetbpRow = (targetbpRow + (8 - 1)) & ~(8 - 1);
        let targetWidthBytes = ((targetbpRow >> 3) + (4 - 1)) & ~(4 - 1);

        let bitmapData = new Uint8Array(targetWidthBytes * height);
        let bitmapView = new DataView(bitmapData.buffer);

        let offset = 0;
        let bytesPerRead = 4;

        // Convert the palette we are using so we hit the target format
        if (this.format != format) {
            fromPalette = fromPalette.slice();
            for (let i = 0; i < fromPalette.length; i++) {
                let clr = fromPalette[i];

                let r,g,b,a;

                // Get components
                if (this.format == Bitmap.RGBA) {
                    r = (clr >> 24) & 0xff;
                    g = (clr >> 16) & 0xff;
                    b = (clr >> 8) & 0xff;
                    a = clr & 0xff;
                }
                else if (this.format == Bitmap.ABGR) {
                    r = clr & 0xff;
                    g = (clr >> 8) & 0xff;
                    b = (clr >> 16) & 0xff;
                    a = (clr >> 24) & 0xff;
                }

                if (format == Bitmap.RGBA) {
                    clr = (r << 24) | (g << 16) | (b << 8) | a;
                }
                else if (format == Bitmap.ABGR) {
                    clr = (a << 24) | (b << 16) | (g << 8) | r;
                }

                fromPalette[i] = clr;
            }
        }

        // Each row has to be a multiple of 4 bytes
        let bpRow = this.bpp * width;
        bpRow = (bpRow + (8 - 1)) & ~(8 - 1);
        let widthBytes = ((bpRow >> 3) + (4 - 1)) & ~(4 - 1);

        // Determine how to read from this bitmap
        let read = view.getUint32.bind(view);
        if (this.bpp == 1) {
            bytesPerRead = 1;
            read = (offset) => {
                let b = view.getUint8(offset);
                return [
                    fromPalette[(b >> 7) & 0x1], fromPalette[(b >> 6) & 0x1],
                    fromPalette[(b >> 5) & 0x1], fromPalette[(b >> 4) & 0x1],
                    fromPalette[(b >> 3) & 0x1], fromPalette[(b >> 2) & 0x1],
                    fromPalette[(b >> 1) & 0x1], fromPalette[(b >> 0) & 0x1],
                ];
            };
        }
        else if (this.bpp == 2) {
            bytesPerRead = 1;
            read = (offset) => {
                let b = view.getUint8(offset);
                return [
                    fromPalette[(b >> 2) & 0x3], fromPalette[b & 0x3],
                    fromPalette[(b >> 6) & 0x3], fromPalette[(b >> 4) & 0x3]
                ];
            };
        }
        else if (this.bpp == 4) {
            bytesPerRead = 1;
            read = (offset) => {
                let b = view.getUint8(offset);
                return [fromPalette[(b >> 4) & 0xf], fromPalette[b & 0xf]];
            };
        }
        else if (this.bpp == 8) {
            bytesPerRead = 1;
            read = (offset) => {
                let b = view.getUint8(offset);
                return [fromPalette[b]];
            };
        }

        let value = 0;
        let count = 0;
        for (let y = 0; y < height; y++) {
            let initialOffset = offset;
            for (let x = 0; x < width; ) {
                let pixels = read(offset, true);
                offset += bytesPerRead;

                pixels.forEach( (pixel) => {
                    // Store the pixel data into the bitmap data
                    if (x < width) {
                        if (bpp == 1) {
                            // TODO: Color does not handle the right color format
                            // It is using ARGB and we are likely using RGBA
                            let color = new Color(pixel >> 8);
                            let index = realPalette.nearestIndex(color.red, color.green, color.blue);
                            value = (value << 1) | (index & 0x1);
                            count++;
                            if (count == 8) {
                                bitmapView.setUint8(y * targetWidthBytes + ((x / 8) >>> 0), value);
                                value = 0;
                                count = 0;
                            }
                        }
                        else if (bpp == 4) {
                            let color = new Color(pixel >> 8);
                            let index = realPalette.nearestIndex(color.red, color.green, color.blue);
                            value = (value << 4) | (index & 0xf);
                            count++;
                            if (count == 2) {
                                bitmapView.setUint8(y * targetWidthBytes + ((x / 2) >>> 0), value);
                                value = 0;
                                count = 0;
                            }
                        }
                        else if (bpp == 8) {
                            // TODO: Color does not handle the right color format
                            // It is using ARGB and we are likely using RGBA
                            let color = new Color(pixel >> 8);
                            let index = realPalette.nearestIndex(color.red, color.green, color.blue);
                            bitmapView.setUint8(y * targetWidthBytes + x, index);
                        }
                        else if (bpp == 32) {
                            bitmapView.setUint32(y * targetWidthBytes + (x * 4), pixel);
                        }
                    }
                    x++;
                });
            }
            offset = initialOffset + widthBytes;
        }

        return new Bitmap(width, height, bpp, format, bitmapView, palette);
    }
}

Bitmap.ABGR = 0;
Bitmap.ARGB = 1;
Bitmap.BGRA = 2;
Bitmap.RGBA = 3;

Bitmap.OPERATIONS = {
    OR: 1,
    AND: 2,
    XOR: 3,
    COPY: 4,
};
