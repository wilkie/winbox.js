"use strict";

import { Color } from "../raster/color.js";
import { Window } from "../window.js";
import { BitmapFont } from "../raster/bitmap-font.js";

export class TextBox extends Window {
    constructor(options = {}) {
        options = Object.assign({}, TextBox.defaultOptions, options);

        console.log("INITIAL OPTIONS", Object.assign({}, options));
        super(options);

        this.resize(100, 16);
        this.move(16, 16);
        this.border = "solid";
        this.alignment = "left";
        this.verticalAlignment = "top";
        this.backgroundColor = new Color(255, 255, 255, 255);

        console.log("text box options", Object.assign({}, this._options));
    }

    initialize() {
        // Do normal creation
        super.initialize();

        // We need to add an <input>
        this._input = document.createElement("input");

        // With a 'text' type
        this._input.setAttribute("type", "text");
        this._input.setAttribute("tabindex", "0");

        // And add it into the widget
        this.element.appendChild(this._input);

        // Add class
        this.element.classList.add("__winbox_text-box");

        // Add coveralls! To hide the native text box.
        this._coveralls = document.createElement("span");
        this._coveralls.classList.add("__winbox_coveralls");
        this.element.appendChild(this._coveralls);

        // Create caption
        this._caption = document.createElement("span");
        this._captionImageSpan = document.createElement("span");

        this._captionImage = document.createElement("img");
        this._captionImageSpan.appendChild(this._captionImage);
        this._captionImageSpan.style.display = "none";

        // Place text representation on the widget
        this.element.appendChild(this._caption);
        this.element.appendChild(this._captionImageSpan);

        // And a caret
        this._caret = document.createElement("div");
        this._caret.classList.add("__winbox_text-box_caret");
        this.element.appendChild(this._caret);

        // Position the caret
        this._caret.style.left = "0";

        // Make the caret 'blink' by starting it idle
        this._caret.classList.add("__winbox_text-box_caret_idle");

        this.value = this.options.value;

        this._input.addEventListener("mousedown", (event) => {
            // Do not allow normal <input> selections
            event.preventDefault();

            // Manually perform the focus
            this._input.focus({ preventScroll: true });
        });

        this._input.addEventListener("input", (event) => {
            this.value = this._input.value;
            this._repositionCaret(this._input.selectionStart);
        });

        this._input.addEventListener("keydown", (event) => {
            // We want to ignore events we handle ourselves
            ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
             "End", "Home"].forEach( (code) => {
                if (event.code === code) {
                    event.preventDefault();
                }
            });
        });

        this.on("keydown", this._keyDownEvent.bind(this));

        this.on("focus", () => { console.log("focused"); });
        this.on("mousedown", this._mouseDownEvent.bind(this));

        this._reposition();
        this._repositionCaret(0);
    }

    get options() {
        return super.options;
    }

    set options(value) {
        super.options = value;

        // Retain the value
        this.value = value.value;
    }

    get cursor() {
        return super.cursor;
    }

    set cursor(value) {
        super.cursor = value;

        this._input.style.cursor = this.element.style.cursor;
    }

    get selectionStart() {
        return this._input.selectionStart;
    }

    set selectionStart(value) {
        value = Math.min(value, this.value.length);
        value = Math.max(0, value);

        this.selectionEnd = value;

        this._repositionCaret(value);
    }

    get selectionEnd() {
        return this._input.selectionEnd;
    }

    set selectionEnd(value) {
        value = Math.min(value, this.value.length);
        value = Math.max(0, value);
        this._input.selectionEnd = value;
    }

    _keyDownEvent(event) {
        if (event.code === "End") {
            this.selectionStart = this.value.length;
        }
        else if (event.code === "Home") {
            this.selectionStart = 0;
        }
        else if (event.code === "ArrowLeft") {
            this.selectionStart = this.selectionStart - 1;
        }
        else if (event.code === "ArrowRight") {
            this.selectionStart = this.selectionStart + 1;
        }
    }

    _mouseDownEvent(event) {
        // Measure the text and determine the position that the mouse click
        // occurred within the text.

        // Do reselection.
        let position = this._charPositionAt(event.x);

        if (event.clicks == 1) {
            this._repositionCaret(position);
        }
        else if (event.clicks == 2) {
            // Select the word at this position
            this._selectWord(position);
        }
    }

    _selectWord(position) {
    }

    // Returns the character position at the given client x coordinate.
    _charPositionAt(x) {
        x -= parseInt(this._caption.style.left);

        if (this._font) {
            // Raster font measurement
            let currentX = 0;
            for (let i = 0; i < this.value.length; i++) {
                let current = this.value.slice(i, i + 1);
                let weight = this.options.weight;
                let metrics = this._font.measure(current, {
                  weight: weight,
                });

                // Windows 3.1 has the caret move before the character most
                // of the time, only giving a couple of pixels of padding on
                // its right-hand side.
                if ((currentX + metrics.width - 2) > x) {
                    return i;
                }

                currentX += metrics.width;
            }
        }
        else {
            // Normal font measurement the browser can actually do
        }

        // By default, go to the end of the field
        return this.value.length;
    }

    _reposition() {
        let x = 2;
        let y = 1;

        [this._caption, this._captionImageSpan].forEach( (span) => {
            span.style.left = (0.0625 * x) + "rem";
            span.style.top  = (0.0625 * y) + "rem";
        });
    }

    _repositionCaret(index) {
        // Position the caret in the actual <input> field
        this._input.selectionStart = index;
        this._input.selectionEnd = index;

        // We start at the left-most edge of the rendered text
        let x = parseInt(this._caption.style.left);
        let y = 0;

        // We need to measure the text to determine the caret placement
        if (this._font) {
            // Raster font measurement
            let weight = this.options.weight;
            let current = this.value.slice(0, index);
            let metrics = this._font.measure(current, {
              weight: weight,
            });
            x += metrics.width + 1;
        }

        // The caret specifically goes to the far-left when index is 0.
        if (index == 0) {
            x = 1;
        }

        // Figure out 'y' sometime...
        y = 2;

        // Move the whole span to have the caret within view

        // Reposition
        this._caret.style.left = (0.0625 * x) + "rem";
        this._caret.style.top  = (0.0625 * y) + "rem";

        // We are not idle
        this._caret.classList.remove("__winbox_text-box_caret_idle");
        window.requestAnimationFrame( () => {
            // This is a nice little trick to have it paint the caret and
            // then start the animation; instead of creating a timer.
            this._caret.classList.add("__winbox_text-box_caret_idle");
        });
    }

    get color() {
        return this._color;
    }

    set color(color) {
        this._color = color;
        this.container.style.color = color.css;
        this.options.color = color;
        this.value = this.value;
    }

    get backgroundColor() {
        return super.backgroundColor;
    }

    set backgroundColor(value) {
        super.backgroundColor = value;

        this._caption.style.backgroundColor = value.css;
        this._captionImageSpan.style.backgroundColor = value.css;
        this._coveralls.style.backgroundColor = value.css;
    }

    set border(value) {
        this._border = value;

        this.element.classList.remove("__winbox_border-solid");
        this.element.classList.add("__winbox_border-" + value);
    }

    get border() {
        return this._border;
    }

    set alignment(value) {
        this._alignment = value;

        this.element.classList.remove("__winbox_align-left");
        this.element.classList.remove("__winbox_align-right");
        this.element.classList.remove("__winbox_align-center");
        this.element.classList.add("__winbox_align-" + value);
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

    get focusable() {
        return true;
    }

    get value() {
        return this._value;
    }

    set value(value) {
        this.options.value = value;
        this._value = value || "";
        this._input.value = value;

        this._caption.textContent = value;
        if (this._options.font &&
            this._options.font.toLowerCase().endsWith(".fon")) {
            BitmapFont.load(this._options.font).then( (fonts) => {
                this._caption.style.display = "none";
                this._captionImageSpan.style.display = "inline";
                let font = fonts.fontFor(this._options.size || 10);
                this._font = font;
                this._measuredText = font.measure(this.value, {
                  weight: this._options.weight,
                });
                this._caret.style.height = (0.0625 * this._measuredText.height) + "rem";
                this._captionImage.setAttribute("src", font.dataFor(this.value, {
                  color: this._options.color,
                  weight: this._options.weight
                }));
                this._captionImage.setAttribute("alt", this._caption.textContent);
            });
        }
        else {
            this._caret.style.height = (0.0625 * this._caption.offsetHeight) + "rem";
        }
    }
}

/**
 * The default options for a TextBox object.
 */
TextBox.defaultOptions = {
    value: "TextBox",
    cursor: "TEXT.CUR",
    cursorFallback: "text"
};

export default TextBox;
