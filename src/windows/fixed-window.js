"use strict";

import { Window } from "../window.js";
import { Button } from "../controls/button.js";
import { SubMenu, Menu } from "../controls/menu.js";
import { RasterFont } from "../raster-font.js";

export class SystemSubMenu extends SubMenu {
}

export class SystemMenu extends Menu {
    initialize() {
        super.initialize();

        this.updateTag("div"); // Make it NOT a <nav>

        // Add a specific class
        this.element.querySelector("button").classList.add("__winbox_close-button");

        this._button.on("mousedown", (event) => {
            //this._ncMouseDown = true;
            //this.options._window.trigger("nonclient-mousedown", event);
        });

        this.parent.on("blur", (event) => {
            this._subWindow.trigger("blur");
        });

        // Create the dropdown menu window
        let subWindow = new SystemSubMenu({ caption: "SUBMENU-" + this.options.caption });
        let blurring = false;
        // Override behavior to not close when system button is clicked
        subWindow.on("blur", () => {
            if (!blurring) {
                if (this._ncMouseDown || this._ncMouseUp) {
                    this._ncMouseDown = false;
                    this._ncMouseUp = false;
                    return;
                }
                blurring = true;
                this.trigger("blur");
                blurring = false;
                subWindow.destroy();
            }
        });
        this._subWindow = subWindow;
    }

    get parent() {
        // Ah, we want the window's root when needed by the Menu
        // This will make sure the spawned popup is parented by the button
        // and rooted in the global space.
        // What a worthy hack!!
        // Should probably just allow appending to a non-client container!
        return this.options._window;
    }

    get spaceX() {
        let parent = this.options._window;
        let titleBar = parent._titleBar;
        let windowX = parent.element.clientLeft;
        let titleBarX = titleBar.offsetLeft + titleBar.clientLeft;
        let elementX = this.element.offsetLeft + this.element.clientLeft;
        return this.options._window.spaceX + windowX + titleBarX + elementX;
    }

    get spaceY() {
        let parent = this.options._window;
        let titleBar = parent._titleBar;
        let windowY = parent.element.clientTop;
        let titleBarY = titleBar.offsetTop + titleBar.clientTop;
        let elementY = this.element.offsetTop + this.element.clientTop;
        let elementH = this.element.offsetHeight;
        return this.options._window.spaceY + windowY + titleBarY + elementY + elementH + 1;
    }
}

export class FixedWindow extends Window {
    constructor(options = {}) {
        // Do normal stuff
        super(options);
    }

    get options() {
        return super.options;
    }

    /**
     * Updates options with the given options.
     */
    set options(value) {
        super.options = value;

        let caption = this._caption;
        let captionImageSpan = this._captionImageSpan;
        let captionImage = this._captionImage;

        this._closeButton.options = this._options.menu || this._options;

        if (this._options.font &&
            this._options.font.toLowerCase().endsWith(".fon")) {
            RasterFont.load(this._options.font).then( (font) => {
                caption.style.display = "none";
                captionImageSpan.style.display = "block";
                captionImage.src = font.fontFor(this._options.size || 10).dataFor(this._options.caption);
                captionImage.setAttribute("alt", caption.textContent);
            });
        }
    }

    get controlBox() {
        return this._controlBoxVisible;
    }

    set controlBox(value) {
        this._controlBoxVisible = value;
        if (this._controlBoxVisible) {
            this._closeButton.show();
        }
        else {
            this._closeButton.hide();
        }
    }

    get container() {
        return this._container;
    }

    /**
     * Whether or not the window is currently movable.
     */
    get movable() {
        return true;
    }

    /**
     * Whether or not the window can receive focus.
     */
    get focusable() {
        return true;
    }
    
    /**
     * Appends a child to this window, if possible.
     */
    append(item) {
        if (item instanceof Menu) {
            super.append(item, true);
        }
        else {
            super.append(item);
        }

        if (item.docked) {
            // Add to a flexed docking section
            if (item.docked == Window.Docked.Top) {
                this._topDock.appendChild(item.element);
            }
        }
    }

    get systemMenu() {
        return this._closeButton;
    }

    initialize() {
        // Do normal creation
        super.initialize();

        // Set bordered style
        this.element.classList.add("__winbox_window-fixed");

        // Create title bar
        this._titleBar = document.createElement("h2");
        this._titleBar.classList.add("__winbox_title-bar");

        // Create close button (which is actually a menu)
        let systemMenuOptions = Object.assign({}, this.options, { caption: "System Menu", _window: this });
        this._closeButton = new SystemMenu(systemMenuOptions);
        this._closeButton.resize(this._closeButton.width, 18);
        this._closeButton.append(new Menu({ caption: "Restore" }));
        this._closeButton.append(new Menu({ caption: "Move" }));
        this._closeButton.append(new Menu({ caption: "Size" }));
        this._closeButton.append(new Menu({ caption: "Minimize" }));
        this._closeButton.append(new Menu({ caption: "Maximize" }));
        this._closeButton.append(new Menu({ caption: "-" }));
        let mnuClose = new Menu({ caption: "Close" });
        this._closeButton.append(mnuClose);
        this._closeButton.append(new Menu({ caption: "-" }));
        this._closeButton.append(new Menu({ caption: "Switch To..." }));

        mnuClose.on("click", (event) => {
            this.destroy();
        });

        // Append to document
        this._titleBar.appendChild(this._closeButton.element);
        this._element.appendChild(this._titleBar);

        // Create window caption
        let caption = document.createElement("span");
        caption.textContent = this._options.caption;
        this._caption = caption;
        this._titleBar.appendChild(caption);

        let captionImageSpan = document.createElement("span");
        captionImageSpan.style.display = "none";
        let captionImage = document.createElement("img");
        this._captionImageSpan = captionImageSpan;
        this._captionImage = captionImage;
        captionImageSpan.appendChild(captionImage);
        this._titleBar.appendChild(captionImageSpan);

        // Create the top docking section which will contain menus etc.
        this._topDock = document.createElement("div");
        this._topDock.classList.add("__winbox_container");
        this._topDock.classList.add("__winbox_docked-container");

        // Append to document
        this._element.appendChild(this._topDock);

        // Create window content container
        this._container = document.createElement("div");
        this._container.classList.add("__winbox_container");

        // Append to document
        this._element.appendChild(this._container);

        this.on("focus", (event) => {
            // Bring ourselves to the top, please
            if (this.parent) {
                this.parent.reorder(this, Window.Order.Top);
            } 
        });

        this.on("nonclient-mousedown", (data) => {
            if (this._titleBarClicked) {
                if (this.movable) {
                    this.trigger("move-start", data);
                }
            }
        });

        this.on("drag", (data) => {
            if (this._titleBarClicked) {
                if (this.movable) {
                    data.to = {};
                    data.to.x = this.x + data.delta.x;
                    data.to.y = this.y + data.delta.y;
                    this.trigger("move-drag", data);
                }
            }
        });

        this.on("drag-end", (data) => {
            if (this._titleBarClicked) {
                this.trigger("move-end", data);
            }
        });

        this.on("nonclient-mouseup", (event) => {
            this._titleBarClicked = false;
        });
    }

    bindEvents() {
        // Title Bar Events
        this.bindTitleBarEvents();

        // Bind normal mouse events
        super.bindEvents();
    }

    bindTitleBarEvents() {
        this._titleBar.addEventListener('mousedown', (event) => {
            // Remember that the title bar was clicked
            this._titleBarClicked = true;
            this.nonClientMouseDownEvent(event);
        });

        this._closeButton.on("mousedown", (event) => {
            if (event.clicks == 2) {
                this.destroy();
            }
            this._closeButton._ncMouseDown = true;
            this.nonClientMouseDownEvent(event);
        });

        this._closeButton.on("mouseup", (event) => {
            this.nonClientMouseDownEvent(event);
        });
    }
}

export default FixedWindow;
