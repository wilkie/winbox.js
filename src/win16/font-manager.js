import { BitmapFont } from '../raster/bitmap-font.js';
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

    add(url) {
        if (url.toLowerCase().endsWith(".fon")) {
            this._loading++;
            BitmapFont.load(url).then( (font) => {
                font.entries.forEach( (entry) => {
                    //this._fonts[entry.name] = this._fonts[entry.name] || {};
                    //this._fonts[entry.name][entry.size] = font;
                    this._fonts[entry.name] = font;
                });
                this._loading--;
                console.log(this._fonts);

                if (this._loading == 0 && this._callback) {
                    this._callback();
                }
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
