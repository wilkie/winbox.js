"use strict";

import { FixedWindow } from "./fixed-window.js";
import { Button } from "../controls/button.js";

export class SizableWindow extends FixedWindow {
    declare _borderClicked: any;
    declare _edges: any;
    declare _resize: any;
    declare _titleBar: any;
    declare _titleBarClicked: any;
    declare maximizeButton: any;
    declare minimizeButton: any;
    declare static defaultOptions: any;
    constructor(options = {}) {
        // Apply default options
        options = Object.assign({}, SizableWindow.defaultOptions, options);

        // Do normal stuff
        super(options);
    }

    get movable() {
        // Do not move if it is maximized
        return !this.element.classList.contains("__winbox_window-maximized");
    }

    get resizable() {
        return true;
    }

    initialize() {
        // Do normal creation
        super.initialize();

        // Set resizable bordered style
        this.element.classList.add("__winbox_window-resizable");

        // Add resize grab points along border
        this._resize = {};
        ["top", "bottom"].forEach( (dir1) => {
            this._resize[dir1] = {};

            ["left", "right"].forEach( (dir2) => {
                const borderElement = document.createElement("div");
                borderElement.classList.add("__winbox_resize-border");
                borderElement.classList.add("__winbox_resize-border_" + dir1 + "-" + dir2);
                this.element.insertBefore(borderElement, this.element.firstChild);
                this._resize[dir1][dir2] = borderElement;

                borderElement.setAttribute('data-direction', dir1 + "-" + dir2);

                const options = this.options.borders[dir1 + dir2.charAt(0).toUpperCase() + dir2.slice(1)];
                borderElement.style.cursor = `url('${options.cursor}'), ${options.cursorFallback}`;

                borderElement.addEventListener("mousedown", (event) => {
                    this.trigger("nonclient-mousedown", event);
                    this._borderClicked = borderElement;
                });

                borderElement.addEventListener("mouseup", (event) => {
                    this.trigger("nonclient-mouseup", event);
                });
            });
        });

        this._edges = {};
        ["top", "bottom", "left", "right"].forEach( (dir) => {
            const borderElement = document.createElement("div");
            borderElement.classList.add("__winbox_resize-border");
            borderElement.classList.add("__winbox_resize-border_" + dir);
            this._edges[dir] = borderElement;
            this.element.insertBefore(borderElement, this.element.firstChild);

            borderElement.setAttribute('data-direction', dir);

            const options = this.options.borders[dir];
            borderElement.style.cursor = `url('${options.cursor}'), ${options.cursorFallback}`;

            borderElement.addEventListener("mousedown", (event) => {
                this.trigger("nonclient-mousedown", event);
                this._borderClicked = borderElement;
            });

            borderElement.addEventListener("mouseup", (event) => {
                this.trigger("nonclient-mouseup", event);
            });
        });

        // Add minimize/maximize buttons
        this.minimizeButton = new Button({ caption: "" });
        this.maximizeButton = new Button({ caption: "" });
        this.minimizeButton.element.classList.add("__winbox_minimize-button");
        this.maximizeButton.element.classList.add("__winbox_maximize-button");
        this._titleBar.appendChild(this.minimizeButton.element);
        this._titleBar.appendChild(this.maximizeButton.element);

        this.maximizeButton.on("mousedown", (event) => {
            this.trigger("nonclient-mousedown", event);
        });

        this.maximizeButton.on("mouseup", (event) => {
            this.trigger("nonclient-mouseup", event);
        });

        this.minimizeButton.on("mousedown", (event) => {
            this.trigger("nonclient-mousedown", event);
        });

        this.minimizeButton.on("mouseup", (event) => {
            this.trigger("nonclient-mouseup", event);
        });

        this.maximizeButton.on("click", () => {
            if (this.maximized) {
                this.restore();
            }
            else {
                this.maximize();
            }
        });

        this.systemMenu.items.forEach( (item) => {
            if (item.caption == "Maximize") {
                item.on("click", (event) => {
                    this.maximizeButton.trigger("click");
                });
            }
        });
    }

    trigger(name, data) {
        if (name == "mousedown") {
            if (this._borderClicked) {
                const direction = this._borderClicked.getAttribute("data-direction");
                this.trigger("resize-" + direction + "-start", data);

                // Do not propagate event
                return;
            }

            // Handle double-clicking on title-bar
            if (this._titleBarClicked) {
                if (data.clicks == 2) {
                    this.maximizeButton.trigger("click");
                }
            }
        }
        else if (name == "drag") {
            if (this._borderClicked) {
                const direction = this._borderClicked.getAttribute("data-direction");
                data.to = {};
                data.to.x = this.x + data.delta.x;
                data.to.y = this.y + data.delta.y;
                this.trigger("resize-" + direction + "-drag", data);
                // Do not propagate event
                return;
            }
        }
        else if (name == "drag-end") {
            if (this._borderClicked) {
                const direction = this._borderClicked.getAttribute("data-direction");
                this.trigger("resize-" + direction + "-end", data);
                this._borderClicked = null;

                // Do not propagate event
                return;
            }
        }

        super.trigger(name, data);
    }
}

/**
 * The default options for a SizableWindow object.
 */
SizableWindow.defaultOptions = {
    caption: "Sizable Window",
    cursor: "POINTER.CUR",
    cursorFallback: "pointer",
    borders: {
        topLeft: {
            cursor: "RESIZENW.CUR",
            cursorFallback: "nw-resize",
        },
        top: {
            cursor: "RESIZENS.CUR",
            cursorFallback: "n-resize",
        },
        topRight: {
            cursor: "RESIZENE.CUR",
            cursorFallback: "ne-resize",
        },
        right: {
            cursor: "RESIZEEW.CUR",
            cursorFallback: "e-resize",
        },
        bottomRight: {
            cursor: "RESIZENW.CUR",
            cursorFallback: "se-resize",
        },
        bottom: {
            cursor: "RESIZENS.CUR",
            cursorFallback: "s-resize",
        },
        bottomLeft: {
            cursor: "RESIZENE.CUR",
            cursorFallback: "sw-resize",
        },
        left: {
            cursor: "RESIZEEW.CUR",
            cursorFallback: "e-resize",
        }
    }
};

export default SizableWindow;
