"use strict";

import { EventComponent } from "../event-component.js";

export class ResizeBox extends EventComponent {
    declare _edges: any;
    declare _element: any;
    constructor(options = {}) {
        super();

        this._element = document.createElement("div");

        this._element.classList.add("__winbox_resize-box");
        this._element.style.width = "200px";
        this._element.style.height = "200px";

        this._edges = {};
        ["top", "bottom", "left", "right"].forEach( (dir) => {
            const borderElement = document.createElement("div");
            borderElement.classList.add("__winbox_resize-box_" + dir);
            this._element.insertBefore(borderElement, this.element.firstChild);
            this._edges[dir] = borderElement;
        });

        this._element.style.visibility = "hidden";

        this._element.addEventListener("mouseup", (event) => {
            this.trigger("mouseup", event);
        });
    }

    get element() {
        return this._element;
    }

    /**
     * Returns the X coordinate of the box.
     */
    get x() {
        return parseInt(this.element.style.left);
    }

    /**
     * Returns the Y coordinate of the box.
     */
    get y() {
        return parseInt(this.element.style.top);
    }

    get width() {
        return parseInt(this.element.style.width);
    }

    get height() {
        return parseInt(this.element.style.height);
    }

    move(x, y) {
        this._element.style.left = x + "px";
        this._element.style.top = y + "px";
    }

    show() {
        console.log("resize show?");
        this.element.style.visibility = "visible";

        // Needs to be the bottom most thing (before the dragging plane)
        const draggingPlanes = this.element.parentNode.querySelectorAll(".__winbox_draggable");
        draggingPlanes.forEach( (draggingPlane) => {
            this.element.parentNode.insertBefore(this.element, draggingPlane);
        });
    }

    hide() {
        this.element.style.visibility = "hidden";
    }

    resize(width, height) {
        this._element.style.width = width + "px";
        this._element.style.height = height + "px";
    }
}

export default ResizeBox;
