import { BitmapFont } from '../raster/bitmap-font.js';
import { Stream } from "../stream.js";
import { Font } from '../raster/font.js';

export class FontManager {
    constructor() {
        this._fonts = {};
        this._loading = 0;

        this._waitPromise = new Promise( (resolve, reject) => {
            if (this._loading == 0) {
                resolve();
            }
            this._callback = resolve;
        });
    }

    wait() {
        return this._waitPromise;
    }

    async load(file) {
        if (file.name.toLowerCase().endsWith(".fon")) {
            let bitmapFont = new BitmapFont(file);
            await bitmapFont.load();

            bitmapFont.entries.forEach( (entry) => {
                this._fonts[entry.name] = bitmapFont;
            });
        }
        else {
            // TrueType Font
        }
    }

    lookup(name) {
        return this._fonts[name];
    }
}
