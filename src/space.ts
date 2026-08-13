"use strict";

import { EventComponent } from "./event-component.js";
import { Ditherer } from "./raster/ditherer.js";
import { Color } from "./raster/color.js";
import { ProgressWindow } from "./progress-window.js";
import { SizableWindow } from "./windows/sizable-window.js";
import { FixedWindow } from "./windows/fixed-window.js";
import { Window } from "./window.js";

/**
 * This is a workspace element that can contain windows.
 *
 * It is created around an existing HTML element and then manages content
 * within that element as items are appended.
 *
 * It serves as the root context for all other windows.
 */
export class Space extends EventComponent {
    declare _backgroundCanvas: any;
    declare _container: any;
    declare _containingWindow: any;
    declare _ditherer: any;
    declare _focused: any;
    declare _items: any;
    declare _options: any;
    declare _window: any;
    declare element: any;
    declare static defaultOptions: any;
    constructor(options = {}) {
        super();

        this._options = Object.assign({}, Space.defaultOptions, options);

        this._ditherer = new Ditherer();
        this._focused = null;
        this._items = [];
    }

    /**
     * Creates and starts the simulation within the given element.
     */
    open(element) {
        // Create containing element
        const container = document.createElement("div");
        container.classList.add("winbox");

        // Create canvas for background image
        const canvas = document.createElement("canvas");
        canvas.classList.add("__winbox_canvas");

        // Add the background canvas to the container
        container.appendChild(canvas);

        // Add the container to the element
        element.appendChild(container);

        // Size the canvas
        const width  = canvas.offsetWidth;
        const height = canvas.offsetHeight;
        canvas.setAttribute('width',  String(width));
        canvas.setAttribute('height', String(height));

        // Retain reference
        this._backgroundCanvas = canvas;

        // Start drawing
        const ctx = canvas.getContext('2d');

        // Draw gradient
        const startColor = new Color(this._options.background.color.gradient[0]);
        const endColor = new Color(this._options.background.color.gradient[1]);

        const barHeight = 20;
        let currentColor = startColor;
        let amount = 0.0;

        for (let currentY = 0; currentY < height; currentY += barHeight) {
            this._ditherer.fill(ctx, 0, currentY, width, barHeight, currentColor.value);
            amount = Math.min(currentY / (height - barHeight * 2), 1.0);
            currentColor = startColor.mix(endColor, amount);
        }

        // Position text
        const header = document.createElement("h1");
        header.classList.add("__winbox_header");
        header.textContent = this._options.title;
        header.style.font = this._options.font;
        //container.appendChild(header);

        this._container = container;

        // Create a main window
        this._window = new Window(this._options);
        this._window._root = this._window;

        this._window.on("signal", (info) => {
            this.trigger("signal", info);
        });

        this._container.appendChild(this._window.element);

        // Create a progress window
        //this._progressWindow = new ProgressWindow();
        //this._fixedWindow = new FixedWindow();

        this._containingWindow = new SizableWindow();

        //this._window.append(this._fixedWindow);
        //this._window.append(this._progressWindow);

        //this._progressWindow.move(200, 50);
        //this._progressWindow.focus();
    }
    
    /**
     * Appends a child to this space, if possible.
     */
    append(item) {
        this._window.append(item);
        item.options = this._options[item.type];
    }

    /**
     * Removes the item from the space.
     */
    remove(item) {
        this._items.splice(this._items.indexOf(item), 1);
        item._parent = null;

        try {
            this.element.removeChild(item.element);
        } catch (e) { }
    }

    /**
     * Retrieves the canvas used to render the background.
     */
    get backgroundCanvas() {
        return this._backgroundCanvas;
    }

    /**
     * Redraws the background of the space.
     */
    drawBackground() {
    }

    get width() {
        return this._window.width;
    }

    get height() {
        return this._window.height;
    }

    get window() {
        return this._window;
    }
}

/**
 * The default options for a Space object.
 */
Space.defaultOptions = {
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
        //font: "1rem Times",
        font: "VGASYS.FON",
        size: 10,
        weight: 400,

        button: {
            font: "sserife.fon",
            size: 8,
            color: 0x0,
            weight: 800
        },

        menu: {
            font: "VGASYS.FON",
            size: 10,
            weight: 400,
        },
    },
    font: "2rem Times",
    fontStyle: "italic",
    title: "Microsoft Office 4.2 Setup"
};

export default Space;
