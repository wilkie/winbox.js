"use strict";

import { Util } from "../util.js";
import { Executable } from "../executable.js";
import { Color } from "./color.js";
import { Font } from "./font.js";

/**
 * A single bitmap font entry from a bitmap font.
 *
 * Generally, this depicts a bitmap font of a particular style or size that
 * is contained among many within a single font file or resource.
 */
export class BitmapFontEntry {
    constructor(data, options = {}) {
        this._view = new DataView(data);

        // The character cache
        this._chars = {};
    }

    get header() {
        if (!this._header) {
            this._header = Util.readStructure(this._view, BitmapFont.FNTHeader, 0, true);
        }

        return this._header;
    }

    get name() {
        if (!this._name) {
            this._name = Util.readString(this._view, this.header.dfFace);
        }

        return this._name;
    }

    get device() {
        if (!this._device) {
            let offset = this.header.dfDevice;
            if (offset) {
                this._device = Util.readString(this._view, this.header.dfDevice);
            }
        }

        return this._device || "";
    }

    /**
     * Returns the version of the font specification being used.
     */
    get version() {
        let major = this._view.getUint8(1);
        let minor = this._view.getUint8(0);

        return major.toString() + "." + minor.toString();
    }

    /**
     * Returns the weight of the font on a scale from 1 to 1000.
     *
     * The weight of a regular font is 400.
     */
    get weight() {
        return this.header.dfWeight;
    }

    /**
     * The point size of this bitmap font.
     */
    get size() {
        return this.header.dfPoints;
    }

    get charSet() {
    }

    /**
     * Draws the bitmap font to the given 2d canvas context.
     */
    draw(ctx, x, y, text, options = {}) {
        let color = options.color || 0x0;
        let weight = options.weight || 400;
        let allowAnnotation = options.allowAnnotation || false;

        if (text === "") {
            return;
        }

        // Measure the text
        let metrics = this.measure(text, options);
        let width = metrics.width;
        let height = metrics.height;

        // Pull out the image data for that region
        let imageData = ctx.getImageData(x, y, width, height);
        let data = imageData.data;

        if (!(color instanceof Color)) {
            color = new Color(color);
        }

        // Paint over the canvas
        let relativeX = 0;
        let annotate = false;
        for (var i = 0; i < text.length; i++) {
            var code = text.charCodeAt(i);

            if (annotate && text[i] == "&") {
                annotate = false;
            }
            else if (allowAnnotation && text[i] == "&") {
                annotate = true;
                continue;
            }

            let info = this.characterEntryFor(code);
            let charWidth = info.width;

            if (this.weight <= 400 && weight > 400) {
                // Bold style is emulated and increase character width by 1
                charWidth++;
            }

            for (let j = 0; j < height; j++) {
                let lastPixel = 0;
                for (let i = relativeX; i < relativeX + charWidth; i++) {
                    let nextPixel = info.glyph[j][i - relativeX] || 0;
                    let pixel = nextPixel;

                    if (!pixel && this.weight <= 400 && weight > 400) {
                        // Bold emulation copies over the pixels
                        pixel = lastPixel;
                    }

                    if (pixel) {
                        let position = ((j * width) + i) * 4;

                        data[position + 0] = color.red;
                        data[position + 1] = color.green;
                        data[position + 2] = color.blue;
                        data[position + 3] = 0xff;
                    }

                    lastPixel = nextPixel;
                }
            }

            if (annotate) {
                annotate = false;

                // Draw the underline for this annotation character
                let j = height - 1;
                for (let i = relativeX; i < relativeX + charWidth; i++) {
                    let position = ((j * width) + i) * 4;

                    data[position + 0] = color.red;
                    data[position + 1] = color.green;
                    data[position + 2] = color.blue;
                    data[position + 3] = 0xff;
                }
            }

            // Go to next character
            relativeX += charWidth;
        }

        ctx.putImageData(imageData, x, y);
    }

    /**
     * Measures the text and returns the dimensions of the given string.
     */
    measure(text, options = {}) {
        let weight = options.weight || 400;
        let allowAnnotation = options.allowAnnotation || false;

        let ret = {
            width: 0,
            height: this.header.dfPixHeight,
        };

        for (var i = 0; i < text.length; i++) {
            var code = text.charCodeAt(i);

            if (allowAnnotation && text[i] == "&") {
                continue;
            }

            let info = this.characterEntryFor(code);
            ret.width += info.width;

            if (this.weight <= 400 && weight > 400) {
                // Bold style is emulated and increase character width by 1
                ret.width++;
            }
        }

        return ret;
    }

    /**
     * Returns an image with the given text rendered in the given color.
     */
    dataFor(text, options = {}) {
        let color = options.color || 0x0;
        let weight = options.weight || 400;
        let width = options.width || 0;

        // Measure the text
        let metrics = this.measure(text, options);

        let lines = [text];
        let height = 0;

        // We may need to measure with word-wrap

        if (width > 0) {
            // Word wrap!
            // For every word...
            let words = text.split(' ');
            let spaceInfo = this.measure(' ', options);
            let line = "";
            let y = 0;
            let maxWidth = 0;

            lines = [];

            // For each line...
            while(words.length > 0) {
                // Determine the words on this current line
                let x = 0;
                let i = 0;
                for( ; i < words.length; i++) {
                    let wordMetrics = this.measure(words[i], options);
                    if (wordMetrics.width + x > width) {
                        // Stop here
                        break;
                    }
                    x += wordMetrics.width + spaceInfo.width;
                }

                x -= spaceInfo.width;
                maxWidth = Math.max(maxWidth, x);

                line = words.slice(0, i).join(" ");
                words = words.slice(i, words.length);

                // Push the line
                lines.push(line);

                // Go to the next line
                y += metrics.height;
            }

            width = maxWidth;
            height = y;
        }
        else {
            // Just measure the line
            width = metrics.width;
            height = metrics.height;
        }

        // Use an internal canvas
        let canvas = document.createElement("canvas");
        canvas.setAttribute("width", width);
        canvas.setAttribute("height", height);

        let ctx = canvas.getContext('2d');

        let y = 0;
        lines.forEach( (line) => {
            this.draw(ctx, 0, y, line, options);
            y += metrics.height;
        });
        return canvas.toDataURL("image/png");
    }

    /**
     * Returns the character information for the given codepoint.
     */
    characterEntryFor(code) {
        if (!this._chars[code]) {
            if (typeof code === 'string') {
                code = code.charCodeAt(0);
            }

            if (code < this.header.dfFirstChar || code > this.header.dfLastChar) {
                return this.characterEntryFor(this.header.dfDefaultChar +
                                              this.header.dfFirstChar);
            }

            let entrySize = 6; // 3.x fonts
            let headerSize = 148;
            let entryDefinition = BitmapFont.FNT3CharacterEntry;
            if (this.header.dfVersion <= 0x200) {
                entrySize = 4; // 2.x fonts
                entryDefinition = BitmapFont.FNT2CharacterEntry;
                headerSize = 118;
            }

            let offset = code - this.header.dfFirstChar;
            offset *= entrySize;
            offset += headerSize;

            let info = Util.readStructure(this._view, entryDefinition, offset);

            // Read raster data
            offset = info.offset;

            info.glyph = new Array(this.header.dfPixHeight);

            // Read each scanline 8 pixels at a time
            for (var i = 0; i < info.width; i += 8) {
                // Read an entire 8 pixel column
                for (var j = 0; j < this.header.dfPixHeight; j++) {
                    if (info.glyph[j] === undefined) {
                        info.glyph[j] = [];
                    }
                    let b = this._view.getUint8(offset);
                    for (var sb = 0; sb < 8; sb++) {
                        if (i + sb < info.width) {
                            info.glyph[j].push((b & 0x80) >> 7);
                            b <<= 1;
                        }
                    }
                    offset++;
                }
            }
            
            this._chars[code] = info;
        }

        return this._chars[code];
    }
}

/**
 * Loads one or more bitmap fonts from a given font resource.
 */
export class BitmapFont extends Font {
    /**
     * Asynchronously loads the font at the given url.
     */
    static load(url, options = {}) {
        if (!BitmapFont._promiseCache[url]) {
            BitmapFont._promiseCache[url] = new Promise( async (resolve, reject) => {
                if (!BitmapFont._cache[url]) {
                    fetch(url).then( (response) => {
                        return response.arrayBuffer();
                    }).then( (data) => {
                        BitmapFont._cache[url] = new BitmapFont(data, options);
                        resolve(BitmapFont._cache[url]);
                    });
                }
                else {
                    resolve(BitmapFont._cache[url]);
                }
            });
        }

        return BitmapFont._promiseCache[url];
    }

    constructor(data, options = {}) {
        super();

        this._view = new DataView(data);
        this._entries = [];

        if (this._view.getUint16(0, true) == 0x5a4d) {
            // This is an executable, pull fonts from resources
            let executable = new Executable(data); 

            // Get font resources
            executable.resources.forEach( (resourceType) => {
                if (resourceType.id == Executable.RESOURCES.Font) {
                    resourceType.entries.forEach( (resource) => {
                        let subData = executable.readResource(resource);
                        let font = new BitmapFontEntry(subData, options);
                        this._entries.push(font);
                    });
                }
            });
        }
        else {
            // Likely its own font
            this._entries.push(new BitmapFontEntry(data, options));
        }
    }

    /**
     * Retrieves a list of BitmapFontEntry objects for each contained font.
     */
    get entries() {
        return this._entries.slice();
    }

    fontFor(size) {
        let ret = null;

        this._entries.forEach( (entry) => {
            if (ret == null ||
                Math.abs(entry.size - size) < Math.abs(entry.size - ret.size)) {

                ret = entry;
            }
        });

        return ret;
    }
}

BitmapFont._promiseCache = {};
BitmapFont._cache = {};

// https://www.undocprint.org/formats/font_formats

BitmapFont.FNTHeader = {
    dfVersion:         [0,   2],
    dfSize:            [2,   4],
    dfCopyright:       [6,   "60"],
    dfType:            [66,  2],
    dfPoints:          [68,  2],
    dfVertRes:         [70,  2],
    dfHorizRes:        [72,  2],
    dfAscent:          [74,  2],
    dfInternalLeading: [76,  2],
    dfExternalLeading: [78,  2],
    dfItalic:          [80,  1],
    dfUnderline:       [81,  1],
    dfStrikeOut:       [82,  1],
    dfWeight:          [83,  2],
    dfCharSet:         [85,  1],
    dfPixWidth:        [86,  2],
    dfPixHeight:       [88,  2],
    dfPitchAndFamily:  [90,  1],
    dfAvgWidth:        [91,  2],
    dfMaxWidth:        [93,  2],
    dfFirstChar:       [95,  1],
    dfLastChar:        [96,  1],
    dfDefaultChar:     [97,  1],
    dfBreakChar:       [98,  1],
    dfWidthBytes:      [99,  2],
    dfDevice:          [101, 4], // Offset to string naming the device name
    dfFace:            [105, 4], // Offset to string naming the font
    dfBitsPointer:     [109, 4], // Absolute address of the bitmap
    dfBitsOffset:      [113, 4], // Offset to bitmap information
    dfReserved:        [117, 1],
    dfFlags:           [118, 4],
    dfAspace:          [122, 2],
    dfBspace:          [124, 2],
    dfCspace:          [126, 2],
    dfColorPointer:    [128, 4],
    dfReserved1:       [132, 16],
};

/**
 * Character entry for a 2.x font.
 */
BitmapFont.FNT2CharacterEntry = {
    width:  [0, 2],
    offset: [2, 2],
};

/**
 * Character entry for a 3.x font.
 */
BitmapFont.FNT3CharacterEntry = {
    width:  [0, 2],
    offset: [2, 4],
};

export default BitmapFont;
