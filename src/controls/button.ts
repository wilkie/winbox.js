"use strict";

import { Window } from "../window.js";
import { PictureBox } from "./picture-box.js";
import { Label } from "./label.js";
import { Color } from "../raster/color.js";

export class Button extends Window {
    declare _alignment: any;
    declare _label: any;
    declare _mouseDown: any;
    declare _pictureBox: any;
    declare _valignment: any;
    declare static defaultOptions: any;
    constructor(options = {}) {
        options = Object.assign({}, Button.defaultOptions, options);

        super(options);

        this.resize(100, 32);
        this.move(16, 16);
        this.alignment = "center";
        this.verticalAlignment = "center";
    }

    get image() {
        if (this._pictureBox) {
            return this._pictureBox.image;
        }
        
        return null;
    }

    set image(value) {
        if (value === null) {
            this._pictureBox.destroy();
            this._pictureBox = null;

            return;
        }

        if (!this._pictureBox) {
            this._pictureBox = new PictureBox();
            this._pictureBox.fitted = true;
            this.append(this._pictureBox);
            this._pictureBox.move(8, 8);

            this._pictureBox.on("resize", () => {
                this._pictureBox.move(8, (this.height - this._pictureBox.height) / 2);
                this._label.resize(this._pictureBox.width, 0, this.width - this._pictureBox.width - 8, this.height);

                if (this._label.caption === "") {
                    this._pictureBox.move((this.width - this._pictureBox.width) / 2, (this.height - this._pictureBox.height) / 2);
                }
            });
        }
        
        this._pictureBox.image = value;
        this._label.resize(this._pictureBox.width, 0, this.width - this._pictureBox.width, this.height);
    }

    get options() {
        return super.options;
    }

    /**
     * Updates options with the given options.
     */
    set options(value) {
        super.options = value;

        this._label.options = this.options;
    }

    get caption() {
        return this._label.caption;
    }

    set caption(value) {
        this._label.caption = value;
    }

    get type() {
        return "button";
    }

    set alignment(value) {
        this._alignment = value;

        this.element.classList.remove("__winbox_align-left");
        this.element.classList.remove("__winbox_align-right");
        this.element.classList.remove("__winbox_align-center");
        this.element.classList.add("__winbox_align-" + value);

        this._label.alignment = value;
    }

    get alignment() {
        return this._alignment;
    }

    set verticalAlignment(value) {
        this._valignment = value;

        this.element.classList.remove("__winbox_valign-top");
        this.element.classList.remove("__winbox_valign-right");
        this.element.classList.remove("__winbox_valign-bottom");
        this.element.classList.add("__winbox_valign-" + value);
    }

    get verticalAlignment() {
        return this._valignment;
    }

    initialize() {
        // Do normal creation
        super.initialize();

        // It's a <button> tag
        this.updateTag("button");

        // Add class
        this.element.classList.add("__winbox_button");

        // Create caption label
        this._label = new Label(this.options);
        this._label.resize(0, 0, this.width, this.height);
        this._label.backgroundColor = new Color(0, 0, 0, 0);
        this._label.move(0, 0);
        this._label.alignment = "center";
        this._label.verticalAlignment = "center";
        this._label.fitted = true;
        this.append(this._label);

        const resize = (event) => {
            if (this._label) {
                this._label.move((this.width - this._label.width) / 2, (this.height - this._label.height) / 2);
            }
        };

        this.on("resize", resize);
        this._label.on("resize", resize);

        this.on("client-mousedown", (event) => {
            this._mouseDown = true;
            this.element.classList.add("__winbox_button_active");
        });

        this.on("client-mouseup", (event) => {
            this._mouseDown = false;
            this.element.classList.remove("__winbox_button_active");
            this.trigger("click");
        });

        this.on("blur", (event) => {
            this.element.classList.remove("__winbox_button_active");
        });

        this.on("mouseleave", (data) => {
            this.element.classList.remove("__winbox_button_active");
        });

        this.on("mouseenter", (data) => {
            if (this._mouseDown) {
                this.element.classList.add("__winbox_button_active");
            }
        });
    }
}

/**
 * The default options for a Button object.
 */
Button.defaultOptions = {
    caption: "Button",
};

export default Button;
