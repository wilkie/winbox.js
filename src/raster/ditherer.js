"use strict";

import { Color } from "./color.js";

/**
 * This class represents a dithered brush with the specified palette.
 */
export class Ditherer {
    constructor(options = {}) {
        this._palette = Ditherer.PALETTEWIN16;
    }

    /**
     * Fills a region within the given canvas 2d context with the given color.
     *
     * The color can be any color within the RGB colorspace which will be dithered.
     */
    fill(context, x, y, w, h, color) {
        // Windows performs an Ordered Dither:
        // https://en.wikipedia.org/wiki/Ordered_dithering

        // We will determine the two colors that "make up" the given color.
        // These are the two closest colors to the given color.
        // If those are the same... well, then we have an exact match and we
        // do a normal fill.
        //
        // If they differ, then we dither.
        //
        // The distance between the requested color and each target color
        // determines the density of each color

        let colors = this.nearestColors(color, 5);

        // Pixel size
        let pixel = 1;

        // Get data
        let imageData = context.getImageData(x, y, w*pixel, h*pixel);
        let data = imageData.data;

        // Rough spread (I wonder what value Windows uses)
        // (converting from 256 shades of a color to 2 shades (dark/light))
        let spread = 256 / 2;

        let r = (color >> 16) & 0xff;
        let g = (color >>  8) & 0xff;
        let b = (color >>  0) & 0xff;

        // Essentially, the threshold quantifies how much movement the pixel
        // goes through in the dithering process, which is based on its x/y
        // position.
        //
        // The spread dictates how far that movement is... it wants to sway
        // a single shade from the nearest color. And spread is a constant
        // here, which means it can only work for palettes with equally
        // spaced out colors... which is kinda true in the windows palette...
        // but not really.

        // We pick a dithering table/stride
        let table = Ditherer.BAYER8;
        let stride = table[0].length;
        let divisor = Math.pow(stride, 2);

        for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) {
                // First, we convert the color to the dither table's colorspace.
                // The divisor is the maximum color value + 1
                let quantizedR = Math.floor((r / 255.0) * (divisor + 1));
                let quantizedG = Math.floor((g / 255.0) * (divisor + 1));
                let quantizedB = Math.floor((b / 255.0) * (divisor + 1));

                // We then get the normalized value in that colorspace.
                let levelR = Math.floor(quantizedR / divisor);
                let levelG = Math.floor(quantizedG / divisor);
                let levelB = Math.floor(quantizedB / divisor);

                // And then finally get the comparable value.
                quantizedR -= Math.floor(levelR * divisor);
                quantizedG -= Math.floor(levelG * divisor);
                quantizedB -= Math.floor(levelB * divisor);

                // The quantized{R,G,B} will be the color to switch to if we
                // go over the threshold.

                let threshold = table[j % stride][i % stride] + 1;

                if (Ditherer.DEBUG) {
                    console.debug("x:", i, "y:", j);
                    console.debug("t:", threshold);
                }

                if (quantizedR >= threshold) {
                    levelR++;
                }
                if (quantizedG >= threshold) {
                    levelG++;
                }
                if (quantizedB >= threshold) {
                    levelB++;
                }

                if (Ditherer.DEBUG) {
                    console.debug("q:", quantizedR);
                    console.debug("l:", levelR);
                    console.debug("c:", (quantizedR >= threshold ? 1 : 0));
                    console.debug("q:", quantizedG);
                    console.debug("l:", levelG);
                    console.debug("c:", (quantizedG >= threshold ? 1 : 0));
                    console.debug("q:", quantizedB);
                    console.debug("l:", levelB);
                    console.debug("c:", (quantizedB >= threshold ? 1 : 0));
                }

                // Convert back to the normal colorspace
                let newR = levelR * 255.0;
                let newG = levelG * 255.0;
                let newB = levelB * 255.0;

                let newColor = new Color(newR, newG, newB);

                let position = (j * w * pixel * pixel) * 4 + (i * pixel) * 4;

                // Windows dither special cases
                if (color == 0xc0c0c0) {
                    // c0c0c0 is the gray they chose in their palette...
                    // so it will be used specifically because the bayer matrix
                    // will never pick it for us.

                    // Interestingly, 0xbfbfbf and 0xc1c1c1 avoid 0xc0c0c0
                    // and use 0x808080 and 0xffffff... so they also must
                    // special case 0xc0c0c0 specifically.
                    newColor = new Color(0xc0, 0xc0, 0xc0);
                }

                // It does seem grayscale colors get a different matrix?
                // Or, perhaps, it uses a different matrix for certain
                // color intensities.
                // Windows 3.1 reacts bizarrely to certain grays.

                for (var m = 0; m < pixel; m++) {
                    for (var n = 0; n < pixel; n++) {
                        let relative = w*pixel*4*m + 4*n;

                        data[position + relative + 0] = newColor.red;
                        data[position + relative + 1] = newColor.green;
                        data[position + relative + 2] = newColor.blue;
                        data[position + relative + 3] = 0xff;
                    }
                }
            }
        }

        context.putImageData(imageData, x, y);
    }

    nearestColor(color) {
        return this.nearestColors(color, 5)[0];
    }

    /**
     * Returns the two nearest colors for the current palette and given color.
     *
     * It also returns their distance.
     */
    nearestColors(color, count = 1) {
        // Create an initial array of size count
        let ret = [{
          distance: 0xfffffff,
          color: color,
          hex: color.toString(16).padStart(6, "0")
        }];
        for (let i = 1; i < count; i++) {
            ret.push(ret[0]);
        }

        let r1 = (color >> 16) & 0xff;
        let g1 = (color >> 8)  & 0xff;
        let b1 = (color >> 0)  & 0xff;

        this._palette.forEach( (target) => {
            let r2 = target[0];
            let g2 = target[1];
            let b2 = target[2];

            let distance = Math.pow(r1 - r2, 2) +
                           Math.pow(g1 - g2, 2) +
                           Math.pow(b1 - b2, 2);
            distance = Math.sqrt(distance);

            let compiled = (target[0] << 16) | (target[1] << 8) | target[2];
            let entry = {
                r: r2,
                g: g2,
                b: b2,
                distance: distance,
                color: compiled,
                hex: compiled.toString(16).padStart(6, "0")
            };

            // Find a position to place this
            for (var i = 0; i < ret.length; i++) {
                if (ret[i].distance >= distance) {
                    // Push this entry down
                    ret = ret.slice(0, i).concat([entry]).concat(ret.slice(i));
                    ret.pop();
                    break;
                }
            }
        });

        // Return the selection
        return ret;
    }

    /**
     * Generates the default VGA palette.
     */
    _generatePalette256() {
        // The VGA palette is 6-bit colorspace (R6G6B6)
        // A terrible port of canidlogic's vgapal.c:
        // https://github.com/canidlogic/vgapal/blob/master/vgapal.c

        // Start with the 16-color palette
        let ret = Ditherer.PALETTE16.concat([]);

        // Generate grayscale entries
        let range = [0x00, 0x10, 0x20, 0x35, 0x45, 0x55, 0x65, 0x75,
                     0x8a, 0x9a, 0xaa, 0xba, 0xca, 0xdf, 0xef, 0xff];
        range.forEach( (value) => {
            ret.push([value, value, value]);
        });

        let addRun = (start, ch, lo, melo, me, mehi, hi) => {
            let r = 0,
                g = 0,
                b = 0,
                up = false,
                v = 0;

            // Get the starting RGB color and add it
            r = lo;
            g = lo;
            b = lo;

            if ((start & 4) == 4) {
                r = hi;
            }
            else if ((start & 2) == 2) {
                g = hi;
            }
            else {
                b = hi;
            }

            // Add (and convert from 6-bit to 8-bit colorspace)
            ret.push([(r << 2) | (r >> 4),
                      (g << 2) | (g >> 4),
                      (b << 2) | (b >> 4)]);

            // If the channel starts high, we go down
            // otherwise, we go up
            up = ((start & ch) != ch);

            // Add remaining 3 colors of the run
            for (var i = 0; i < 3; i++) {
                // Depends on if we are going up or down
                if (up) {
                    v = [melo, me, mehi][i];
                }
                else {
                    v = [mehi, me, melo][i];
                }

                // Adjust to the current targetted channel
                if (ch == 4) {
                    r = v;
                }
                else if (ch == 2) {
                    g = v;
                }
                else {
                    b = v;
                }

                // Add (and convert from 6-bit to 8-bit colorspace)
                ret.push([(r << 2) | (r >> 4),
                          (g << 2) | (g >> 4),
                          (b << 2) | (b >> 4)]);
            }

            // The next run starts at the starting position of this run,
            // with the channel we just handled flipped.
            return start ^ ch;
        };

        // Generate hue cycle entries
        let addCycle = (lo, melo, me, mehi, hi) => {
            // Starting at blue
            let hue = 1;

            // Add a run, updating hue each time
            hue = addRun(hue, 4, lo, melo, me, mehi, hi);
            hue = addRun(hue, 1, lo, melo, me, mehi, hi);
            hue = addRun(hue, 2, lo, melo, me, mehi, hi);

            // Once again
            hue = addRun(hue, 4, lo, melo, me, mehi, hi);
            hue = addRun(hue, 1, lo, melo, me, mehi, hi);
            hue = addRun(hue, 2, lo, melo, me, mehi, hi);
        };

        // Now come the nine RGB cycles, organized in three groups of three
        //   cycles -- the groups represent high value, medium value, and low
        //   value, and the cycles within the groups represent high saturation,
        //   medium saturation, low saturation
        addCycle( 0, 16, 31, 47, 63);
        addCycle(31, 39, 47, 55, 63);
        addCycle(45, 49, 54, 58, 63);

        addCycle( 0,  7, 14, 21, 28);
        addCycle(14, 17, 21, 24, 28);
        addCycle(20, 22, 24, 26, 28);

        addCycle( 0,  4,  8, 12, 16);
        addCycle( 8, 10, 12, 14, 16);
        addCycle(11, 12, 13, 15, 16);

        // The final 8 entries are just black repeated.
        // Very inefficient palette, this.
        ret.append([0x00, 0x00, 0x00]);
        ret.append([0x00, 0x00, 0x00]);
        ret.append([0x00, 0x00, 0x00]);
        ret.append([0x00, 0x00, 0x00]);
        ret.append([0x00, 0x00, 0x00]);
        ret.append([0x00, 0x00, 0x00]);
        ret.append([0x00, 0x00, 0x00]);
        ret.append([0x00, 0x00, 0x00]);

        return ret;
    }
}

/**
 * The threshold matrix (Bayer matrix) for Ordered dithering.
 */
Ditherer.BAYER2 = [
    [ 0, 3],
    [ 2, 1],
];

Ditherer.BAYER4 = [
    [ 0, 12,  3, 15],
    [ 8,  4, 11,  7],
    [ 2, 14,  1, 13],
    [10,  6,  9,  5]
];

Ditherer.BAYER8 = [
    [0,  48, 12, 60,  3, 51, 15, 63],
    [32, 16, 44, 28, 35, 19, 47, 31],
    [8,  56,  4, 52, 11, 59,  7, 55],
    [40, 24, 36, 20, 43, 27, 39, 23],
    [ 2, 50, 14, 62,  1, 49, 13, 61],
    [34, 18, 46, 30, 33, 17, 45, 29],
    [10, 58,  6, 54,  9, 57,  5, 53],
    [42, 26, 38, 22, 41, 25, 37, 21]
];

/**
 * The list of 16 colors that are part of the Windows 16-color palette.
 */
Ditherer.PALETTEWIN16 = [
    [0xff, 0xff, 0xff],
    [0xff, 0xff, 0x00],
    [0x00, 0xff, 0xff],
    [0xff, 0x00, 0xff],
    [0xff, 0x00, 0x00],
    [0x00, 0xff, 0x00],
    [0x00, 0x00, 0xff],
    [0xc0, 0xc0, 0xc0],
    [0x80, 0x80, 0x80],
    [0x80, 0x80, 0x00],
    [0x00, 0x80, 0x80],
    [0x80, 0x00, 0x80],
    [0x80, 0x00, 0x00],
    [0x00, 0x80, 0x00],
    [0x00, 0x00, 0x80],
    [0x00, 0x00, 0x00],
];

/**
 * The list of 16 colors that are part of the EGA 16-color palette.
 */
Ditherer.PALETTE16 = [
    [0xff, 0xff, 0xff],
    [0xff, 0xff, 0x55],
    [0x55, 0xff, 0xff],
    [0xff, 0x55, 0xff],
    [0xff, 0x55, 0x55],
    [0x55, 0xff, 0x55],
    [0x55, 0x55, 0xff],
    [0x55, 0x55, 0x55],
    [0xaa, 0xaa, 0xaa],
    [0xaa, 0xaa, 0x00],
    [0x00, 0xaa, 0xaa],
    [0xaa, 0x00, 0xaa],
    [0xaa, 0x00, 0x00],
    [0x00, 0xaa, 0x00],
    [0x00, 0x00, 0xaa],
    [0x00, 0x00, 0x00],
];

Ditherer.DEBUG = false;

export default Ditherer;
