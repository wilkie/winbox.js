"use strict";

import { Window } from "../window.js";
import { Color } from "../raster/color.js";

export class PictureBox extends Window {
    initialize() {
        super.initialize();

        // This is an <img> tag
        this.updateTag("img");

        this.element.addEventListener("load", () => {
            if (this.fitted) {
                this.fit();
            }
        });

        this.backgroundColor = new Color(0x0, 0x0, 0x0, 0x0);
    }

    get image() {
        return this._image;
    }

    set image(value) {
        this._image = value;
        this.element.src = value;

        if (this.fitted) {
            this.fit();
        }
    }

    /**
     * Whether or not this always resizes to fit its contents.
     */
    get fitted() {
        return this._fitted;
    }

    set fitted(value) {
        this._fitted = value;

        if (this._fitted) {
            this.fit();
        }
    }

    /**
     * Resizes the window to fit its contents.
     */
    fit() {
        // Resize the image to fit the text metrics.
        this.element.style.width = "auto";
        this.element.style.height = "auto";

        let width = this.element.offsetWidth;
        let height = this.element.offsetHeight;

        this.resize(width, height);
    }
}

export default PictureBox;
