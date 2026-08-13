"use strict";

import { Draw } from "../raster/draw.js";
import { Window } from "../window.js";
import { CheckBox } from "./check-box.js";

export class OptionButton extends CheckBox {
    declare _checkBox: any;
    declare _checkBoxImg: any;
    declare _value: any;
    declare static Value: any;
    declare static __selectedImage: any;
    declare static __unselectedImage: any;
    declare static defaultOptions: any;
    constructor(options = {}) {
        options = Object.assign({}, OptionButton.defaultOptions, options);

        super(options);
    }

    initialize() {
        // Do normal creation
        super.initialize();

        // Generate checkbox images
        // Use an internal canvas
        if (!OptionButton.__unselectedImage) {
            let canvas = document.createElement("canvas");
            canvas.setAttribute("width", String(13));
            canvas.setAttribute("height", String(13));

            let ctx = canvas.getContext('2d');
            Draw.drawCircle(ctx, 0, 0, 13, 13);
            OptionButton.__unselectedImage = canvas.toDataURL("image/png");

            canvas = document.createElement("canvas");
            canvas.setAttribute("width", String(13));
            canvas.setAttribute("height", String(13));

            ctx = canvas.getContext('2d');
            Draw.drawCircle(ctx, 0, 0, 13, 13);
            Draw.fillCircle(ctx, 3, 3, 7, 7);
            OptionButton.__selectedImage = canvas.toDataURL("image/png");
        }

        // Add class
        this.element.classList.add("__winbox_optionbutton");

        this._checkBox.setAttribute("type", "radio");

        this.on("load", (event) => {
            if (this.parent) {
                this._checkBox.setAttribute("name", "__winbox_radio" + this.parent.id + "[]");
            }
        });
    }

    get value() {
        return this._value;
    }

    set value(value) {
        if (this.value == OptionButton.Value.Checked &&
            value == OptionButton.Value.Unchecked) {
            return;
        }

        this._value = value;

        if (this._value == OptionButton.Value.Checked) {
            this._checkBoxImg.src = OptionButton.__selectedImage;
            this._checkBox.checked = true;
        }
        else {
            this._checkBoxImg.src = OptionButton.__unselectedImage;
            this._checkBox.checked = false;
        }

        // Turn off all other option buttons of our parent
        if (this.parent) {
            this.parent.items.forEach( (item) => {
                if (item !== this && item instanceof OptionButton) {
                    if (item._value == OptionButton.Value.Checked) {
                        // The browser already updated the state,
                        // so item._checkBox.checked is already false
                        item._checkBoxImg.src = OptionButton.__unselectedImage;
                        item._value = OptionButton.Value.Unchecked;

                        // We will pretend and have the browser issue the
                        // appropriate event as though it were clicked.
                        // (We could pass events through and react to 'change'
                        // ourselves on the native input element...)
                        const event = new Event('change');
                        item._checkBox.dispatchEvent(event);
                    }
                }
            });
        }
    }
}

OptionButton.Value = {
    Unchecked: 0,
    Checked: 1,
};

OptionButton.defaultOptions = {
    caption: "Option",
};

export default OptionButton;
