"use strict";

import { Window } from "../window.js";
import { Label } from "./label.js";

export class ListBox extends Window {
    constructor(options = {}) {
        options = Object.assign({}, ListBox.defaultOptions, options);

        super(options);

        this.resize(100, 100);
        this.move(16, 16);
    }
}

/**
 * The default options for a ListBox object.
 */
ListBox.defaultOptions = {
};

export default ListBox;
