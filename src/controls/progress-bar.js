"use strict";

import { Window } from "../window.js";
import { Label } from "./label.js";
import { Color } from "../color.js";

export class ProgressBar extends Window {
    constructor(options = {}) {
        options = Object.assign({}, Label.defaultOptions, options);

        super(options);

        this.resize(100, 16);
        this.move(16, 16);
        this.alignment = "left";
        this.verticalAlignment = "center";
        this.value = 0.0;
        this.border = "solid";
    }

    initialize() {
        // Do normal creation
        super.initialize();

        // Add class
        this.element.classList.add("__winbox_progress-bar");

        // Create the background label
        this._backLabel = new Label(this.options);
        this.append(this._backLabel);
        this._backLabel.move(0, 0);
        this._backLabel.alignment = "center";
        this._backLabel.verticalAlignment = "center";
        this._backLabel.resize(null, null);
        this._backLabel.fitted = true;

        // Create a blank window that will be the filled-in part
        this._blank = new Window();
        this._blank.backgroundColor = new Color(0, 0, 255);
        this.append(this._blank);
        this._blank.move(0, 0);
        this._blank.resize(32, this.height);

        // Create the foreground label
        this._label = new Label(this.options);
        this._blank.append(this._label);
        this._label.move(0, 0);
        this._label.alignment = "center";
        this._label.verticalAlignment = "center";
        this._label.fitted = true;
        this._label.backgroundColor = new Color(0, 0, 255);
        this._label.color = new Color(255, 255, 255);

        let resize = () => {
            this._label.move((this.width - this._label.width) / 2, (this.height - this._label.height) / 2);
            this._backLabel.move((this.width - this._backLabel.width) / 2, (this.height - this._backLabel.height) / 2);
            this._blank.resize(this.value * this.width, this.height);
        };

        this._label.on("resize", resize);
        this._backLabel.on("resize", resize);
        this.on("resize", resize);
    }

    get value() {
        return this._value;
    }

    set value(value) {
        this._value = value;

        this._label.caption = Math.round(value * 100) + "%";
        this._backLabel.caption = this._label.caption;

        this._label.fit();
        this._backLabel.fit();
    }

    set border(value) {
        this._border = value;

        this.element.classList.remove("__winbox_border-solid");
        this.element.classList.add("__winbox_border-" + value);
    }

    get border() {
        return this._border;
    }
}

export default ProgressBar;
