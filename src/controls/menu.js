"use strict";

import { Window } from "../window.js";
import { PopupWindow } from "../windows/popup-window.js";
import { Button } from "./button.js";

/**
 * Represents the dropdown menu for a window's menubar.
 */
export class SubMenu extends PopupWindow {
    constructor(options = {}) {
        super(options);

        // Create the menu items list
        this._menuItems = document.createElement("ol");
        this.container.appendChild(this._menuItems);
    }

    /**
     * Appending items to the menu will place them in the menu's listing.
     */
    append(item) {
        super.append(item);

        // Rip away the DOM hierarchy for the menu items
        if (item instanceof Menu) {
            this._menuItems.appendChild(item.element);
        }
    }
}

/**
 * Represents a dropdown menu at the top of a window or subitems within.
 */
export class Menu extends Window {
    constructor(options = {}) {
        options = Object.assign({}, Menu.defaultOptions, options);

        super(options);

        this.resize(0, 19);
    }

    get type() {
        return "menu";
    }

    get caption() {
        return this.options.caption;
    }

    set caption(value) {
        this.options.caption = value;

        this._button.caption = value;
    }

    get x() {
        return this._element.offsetLeft;
    }

    get y() {
        return this._element.offsetTop;
    }

    get items() {
        if (this._subWindow) {
            // Return the items within the submenu
            return this._subWindow.items;
        }
        else {
            // Ignore the button
            return super.items.slice(1);
        }
    }

    initialize() {
        // Do normal creation
        super.initialize();

        // Add class
        this.element.classList.add("__winbox_menu");

        // Assume it is a main menu
        this._updateToMainMenu();

        if (this._options.caption === "-") {
            // If it is a separator... it's just a line and no button
            this.element.classList.add("__winbox_menu_separator");

            this.on("mouseenter", (event) => {
                if (this.parent.focused && event.buttons == 1) {
                    this.focus();
                }
            });

            this.on("mouseup", (event) => {
                if (this.root) {
                    this.root._draggablePlane.hide();
                }

                // This should just be the same as a mouseup on the parent menu.
                this.parent.parent.trigger("client-mouseup");
            });
            return;
        }

        // Add a invoking button
        this._button = new Button(this._options);
        this.append(this._button);

        // Add a listing
        this._menuItems = document.createElement("ol");
        this.element.appendChild(this._menuItems);

        // Create the dropdown menu window
        let subWindow = new SubMenu({ caption: "SUBMENU-" + this.options.caption });
        let blurring = false;
        subWindow.on("blur", (event) => {
            if (!blurring) {
                blurring = true;
                this.trigger("blur");
                blurring = false;
                subWindow.destroy();
            }
        });
        this._subWindow = subWindow;

        // Add events
        this._button.on("client-mousedown", (event) => {
            this.focus();
            this.open();
            let current = this.parent;
            while(current && current.element.tagName.toUpperCase() != "NAV") {
                current = current.parent;
            }

            if (current) {
                let box = current.element.getBoundingClientRect();
                this.root._draggablePlane.mask(box,
                    current.moveDragEndEvent.bind(current));
            }
        });

        this._button.on("mouseenter", (event) => {
            if (this.parent.focused && event.buttons == 1) {
                this.focus();
                this.open();
            }
        });

        this._button.on("mousedown", (event) => {
            this.trigger("mousedown", event);
        });

        this._button.on("mouseleave", (event) => {
        });

        this._button.on("click", (event) => {
            // Invoke the menu
            this.trigger("click", event);
            if (this.root) {
                this.root._draggablePlane.hide();
            }
        });

        this._button.on("client-mouseup", (event) => {
            // If a submenu exists, we focus on the first entry
            if (this._subWindow && this._subWindow.items.length > 0) {
                this._subWindow.items[0]._button.focus();
            }
            else {
                // This just acts like a button... but we immediately lose focus
                this.trigger("blur");

                // We need to close ALL menus, so we blur all Menu parents
                let item = this.parent;
                while(item) {
                    if (item instanceof Menu) {
                        item.trigger("blur");
                    }
                    item = item.parent;
                }
            }
        });
    }

    open() {
        if (!this.parent.parent) {
            this.close();
            return;
        }

        this._button.focus();

        // Create an unbordered window for the menu items

        // This places the child window at the top-left of the actual
        // container... we want it to overlap slightly though.
        // Therefore we subtract 1 from the Y.
        if (this._subWindow && this._subWindow.items.length > 0) {
            this._subWindow.move(this.spaceX, this.spaceY - 1);

            this._subWindow.element.classList.add("__winbox_menu-dropdown");

            // Append it to the root space (but have it be owned by the button)
            // This allows the button (the menu item text) to be in focus
            this._subWindow.destroy();
            this._button.append(this._subWindow);
            this._subWindow.focus();
        }
    }

    close() {
        this._subWindow.destroy();
    }

    /**
     * Menus are always docked to the top of its container.
     */
    get docked() {
        return Window.Docked.Top;
    }

    /**
     * Appending items to the menu will place them in the menu's listing.
     */
    append(item) {
        if (item instanceof Menu) {
            // The appended menu is always a submenu
            item._updateToSubMenu();
        }

        super.append(item);

        // Rip away the DOM hierarchy for the menu items
        if (item instanceof Menu) {
            if (this.element.tagName.toUpperCase() === "NAV") {
                // They go into our listing for main menus
                this._menuItems.appendChild(item.element);
            }
            else if (this._subWindow) {
                // They go into the popup window for dropdowns
                this._subWindow.append(item);
            }
        }
    }

    _updateToSubMenu() {
        // Update element to be a <li> tag
        this.updateTag("li");

        // Show button
        if (this._button) {
            this._button.show();
        }

        // Hide list
        if (this._menuItems) {
            this._menuItems.setAttribute("hidden", "");
            this._menuItems.setAttribute("aria-hidden", "true");
        }

        // The list is part of the subwindow
        if (this._subWindow) {
            super.items.forEach( (item) => {
                if (item instanceof Menu) {
                    this._subWindow.append(item);
                }
            });
        }

        // Add ARIA content
        if (this._options.caption !== "-") {
            this.element.setAttribute("role", "menuitem");
            this.element.setAttribute("aria-role", "menuitem");
            this.element.removeAttribute("aria-orientation");
        }
    }

    _updateToMainMenu() {
        // Update element to be a <nav> tag
        this.updateTag("nav");

        // Hide button
        if (this._button) {
            this._button.hide();
        }

        // Show list
        if (this._menuItems) {
            this._menuItems.removeAttribute("hidden");
            this._menuItems.removeAttribute("aria-hidden");
        }

        // The list is part of the main window
        if (this._subWindow) {
            this._subWindow.items.forEach( (item) => {
                if (item instanceof Menu) {
                    this.append(item);
                }
            });
        }

        // Add ARIA content
        this.element.setAttribute("role", "menubar");
        this.element.setAttribute("aria-role", "menubar");
        this.element.setAttribute("aria-orientation", "horizontal");
    }

    _clientMouseEvent(name, data) {
        if (!this.focused) {
            super._clientMouseEvent(name, data);
        }
    }
}

/**
 * The default options for a Menu object.
 */
Menu.defaultOptions = {
};

export default Menu;
