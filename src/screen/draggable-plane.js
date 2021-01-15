"use strict";

/**
 * This is a low-level class to represent the drag plane which captures drag
 * events.
 *
 * This masks out the entire screen when an object is requesting a drag event
 * as to capture all mousemove events in a global coordinant space.
 *
 * Optionally, the drag plane can be set up to mask out a global region, so
 * only events are captures for the given region.
 *
 * Any PopupWindow will ignore the drag plane, however.
 */
export class DraggablePlane {
    constructor(element) {
        // Create the draggable surfaces
        this._draggables = [0,0,0,0].map( (_) => {
            let draggable = document.createElement("div");
            draggable.classList.add("__winbox_draggable");
            draggable.style.position = "absolute";
            //draggable.style.background = "red";
            draggable.style.left = "0";
            draggable.style.top = "0";
            draggable.style.right = "0";
            draggable.style.bottom = "0";
            draggable.style.visibility = "hidden";
            draggable.addEventListener('mouseleave', this._trackLeave.bind(this));
            draggable.addEventListener('mouseenter', this._trackEnter.bind(this));
            draggable.addEventListener('mousemove', this._trackMove.bind(this));
            draggable.addEventListener('mouseup', this._trackUp.bind(this));
            return draggable;
        });

        // We will mask the entire screen by default
        this._bounds = null;

        // Retain the element
        this._element = element;

        // We will keep track of if the cursor is within the planes or not.
        this._entered = 0;

        // The initial state
        this._state = {
            x: 0,
            y: 0
        };
    }

    /**
     * Updates the drag plane to mask out the given region.
     */
    mask(box, endCallback) {
        this._state = {
            x: box.x,
            y: box.y,
            endCallback: endCallback,
        };
        this._bounds = box;

        this.initialize();
        this.show();
    }

    /**
     * Updates the drag plane to mask out the entire screen.
     */
    unmask() {
        this._bounds = null;

        this.initialize();
        this.hide();
    }

    /**
     * Sets up the dragging plane surface.
     */
    initialize() {
        this._entered = 0;

        // Place draggable surface under popups when masking
        this._popup = this._element.querySelector(":scope > .__winbox_window_popup");

        // And place resize box at bottom when masking
        this._resizeBox = this._element.querySelector(":scope > .__winbox_resize-box");

        // Create a draggable surface
        let draggables = this._draggables;
        if (!this._bounds) {
            draggables = [this._draggables[0]];
        }

        draggables.forEach( (draggable, i) => {
            if (this._bounds) {
                if (this._popup) {
                    this._element.insertBefore(draggable, this._popup);
                }
                else {
                    this._element.appendChild(draggable);
                }

                if (this._resizeBox) {
                    this._element.appendChild(this._resizeBox);
                }
            }
            else {
                // Otherwise, it goes over everything
                this._element.appendChild(draggable);
            }
            draggable.style.left = "0";
            draggable.style.top = "0";
            draggable.style.right = "0";
            draggable.style.bottom = "0";
            draggable.style.width = "";
            draggable.style.height = "";

            // Mask out the area around the widget
            if (i == 0) { // Left side
                if (this._bounds) {
                    draggable.style.right = "auto";
                    draggable.style.width = this._bounds.x + "px";
                }
            }
            else if (i == 1) { // Top side
                draggable.style.bottom = "auto";
                draggable.style.height = this._bounds.y + "px";
            }
            else if (i == 2) { // Right side
                draggable.style.left = (this._bounds.x + this._bounds.width) + "px";
            }
            else if (i == 3) {
                draggable.style.top = (this._bounds.y + this._bounds.height) + "px";
            }
        });
    }

    /**
     * Tracks the drag events from the given mousedown event.
     *
     * This overrides any currently in-progress.
     *
     * The callbacks given will be issued approprately.
     */
    track(event, dragCallback, endCallback) {
        this._state = {
            x: event.pageX,
            y: event.pageY,
            dragCallback: dragCallback,
            endCallback: endCallback,
        };

        this.unmask();
        this.show();
    }

    /**
     * Shows the dragging plane.
     */
    show() {
        let draggables = this._draggables;
        if (!this._bounds) {
            draggables = [this._draggables[0]];
        }

        draggables.forEach( (draggable) => {
            draggable.style.visibility = "visible";
        });
    }

    /**
     * Hides the dragging plane.
     */
    hide() {
        this._draggables.forEach( (draggable) => {
            draggable.style.visibility = "hidden";
        });
    }

    /**
     * Handles draggable plane mouseleave events.
     */
    _trackLeave(event) {
        this._entered--;

        // A 'mouseleave' on a dragging plane is a 'mouseenter' on the target.
        if (this._state.enterCallback) {
            if (this._entered == 0) {
                this._state.leaveCallback(this._createEvent(event));
            }
        }
    }

    /**
     * Handles draggable plane mouseenter events.
     */
    _trackEnter(event) {
        this._entered++;

        // A 'mouseenter' on a dragging plane is a 'mouseleave' on the target.
        if (this._state.leaveCallback) {
            if (this._entered == 1) {
                this._state.leaveCallback(this._createEvent(event));
            }
        }
    }

    /**
     * Handles the global mousemove events.
     */
    _trackMove(event) {
        if (this._state.dragCallback) {
            this._state.dragCallback(this._createEvent(event));
        }
    }

    /**
     * Handles the global mouseup events.
     */
    _trackUp(event) {
        if (this._state.endCallback) {
            this._state.endCallback(this._createEvent(event));
        }

        this.unmask();
    }

    /**
     * Creates the appropriate event based on the tracked object.
     */
    _createEvent(event) {
        let mousePosition = {x: event.pageX, y: event.pageY };
        let deltaX = mousePosition.x - this._state.x;
        let deltaY = mousePosition.y - this._state.y;

        event.origin = {
            x: this.x,
            y: this.y
        };

        event.delta = {
            x: deltaX,
            y: deltaY
        };

        return event;
    }
}
