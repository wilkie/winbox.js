"use strict";

import { Ditherer } from "./ditherer.js";
import { Color } from "./color.js";
import { ProgressWindow } from "./progress-window.js";
import { ResizeBox } from "./resize-box.js";
import { Win16 } from "./win16.js";

export class WinBox {
    constructor(options = {}) {
        this._options = Object.assign({}, SetupSimulator.defaultOptions, options);

        this._ditherer = new Ditherer();
    }

    /**
     * Creates and starts the simulation within the given element.
     */
    open(element) {
        // Create containing element
        let container = document.createElement("div");
        container.classList.add("winbox");

        // Create canvas
        let canvas = document.createElement("canvas");
        canvas.classList.add("__winbox_canvas");

        // Add the background canvas to the container
        container.appendChild(canvas);

        // Add the container to the element
        element.appendChild(container);

        // Size the canvas
        let width  = canvas.offsetWidth;
        let height = canvas.offsetHeight;
        canvas.setAttribute('width',  width);
        canvas.setAttribute('height', height);

        // Retain reference
        this._backgroundCanvas = canvas;

        // Start drawing
        let ctx = canvas.getContext('2d');

        // Draw gradient
        let startColor = new Color(this._options.background.color.gradient[0]);
        let endColor = new Color(this._options.background.color.gradient[1]);

        let barHeight = 20;
        let currentColor = startColor;
        let amount = 0.0;

        for (let currentY = 0; currentY < height; currentY += barHeight) {
            this._ditherer.fill(ctx, 0, currentY, width, barHeight, currentColor.value);
            amount = Math.min(currentY / (height - barHeight * 2), 1.0);
            currentColor = startColor.mix(endColor, amount);
        }

        // Position text
        let header = document.createElement("h1");
        header.classList.add("__winbox_header");
        header.textContent = this._options.title;
        container.appendChild(header);

        // Create a progress window
        this._progressWindow = new ProgressWindow();

        this._containingWindow = new ResizableWindow();
        //this._containingWindow.append(this._progressWindow);

        this._container = container;

        //this.append(this._progressWindow);
    }
    
    /**
     * Appends a child to this window, if possible.
     */
    append(item) {
        this._container.insertBefore(item.element, this._resizeBox.element);
        item.options = this._options[item.type];
    }

    /**
     * Retrieves the canvas used to render the background.
     */
    get backgroundCanvas() {
        return this._backgroundCanvas;
    }

    /**
     * Redraws the background.
     */
    drawBackground() {
    }
}

/**
 * The default options for a WinBox object.
 */
WinBox.defaultOptions = {
    padding: {
        left: 10,
        right: 10,
        bottom: 10,
        top: 10
    },
    background: {
        color: {
            gradient: [0x0000ff, 0x000000]
        }
    },
    window: {
        font: "VGASYS.FON",
        button: {
            font: "VGASYS.FON"
        },
    },
    font: "3rem Arial Black",
    title: "Hello World"
};

export default WinBox;
