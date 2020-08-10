"use strict";

import { Window } from "../window.js";

/**
 * A PopupWindow is a window that is a child of another but painted on the
 * overall space as though it were a top-level window.
 *
 * This is what you would use to create a dropdown or dialog that needs to
 * appear over the main window but painted past the bounds of that window.
 *
 * It will be the child of the root space but logically the child of its
 * normal parent for consideration of focus and ownership.
 */
export class PopupWindow extends Window {
    constructor(options = {}) {
        super(options);
    }

    initialize() {
        super.initialize();

        this.element.classList.add("__winbox_window_popup");

        this._popupLoaded = false;
        this.on("load", (event) => {
            if (!this._popupLoaded) {
                // Do not repeat
                this._popupLoaded = true;

                // Add this to the top-level root
                this.root.append(this, false, true);

                // Find the parent window? Somehow?
                let current = this.parent;
                while (current && !current.movable) {
                    current = current.parent;
                }

                if (current) {
                    current.on("client-mousedown", (event) => {
                        if (this.focused) {
                            console.log("mousedown AH");
                            console.log(event.target);
                            if (event.target) {
                                if (event.target.window !== this.parent) {
                                    console.log("blurring", this.parent, event.target.window);
                                    this.trigger("blur");
                                }
                            }
                        }
                    });

                    current.on("nonclient-mousedown", (event) => {
                        if (this.focused) {
                            console.log("nonclient-mousedown AH");
                            console.log(event.target);
                            if (event.target) {
                                if (event.target.window !== this.parent) {
                                    console.log("blurring", this.parent, event.target.window);
                                    this.trigger("blur");
                                }
                            }
                        }
                    });
                }
            }
        });

        this.on("unload", () => {
            this._popupLoaded = false;
        });

        this.on("focus", () => {
            // Bring ourselves to the top, please
            if (this.parent) {
                this.parent.reorder(this, Window.Order.Top);
            } 
        });
    }
}

export default PopupWindow;
