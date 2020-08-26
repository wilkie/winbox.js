"use strict";

import { Surface } from '../../raster/surface.js';

import { NULL } from '../consts.js';

export function CreateCompatibleDC(hdc) {
    // Gather the surface we are 'emulating'
    // (Although it does not really matter much at the moment)
    let surface = null;
    if (hdc == NULL) {
        // The screen device
        surface = this._desktop.surface;
    }
    else {
        surface = this.handles.resolve(hdc);
    }

    // Error out if we don't understand the given hdc.
    if (!surface) {
        return NULL;
    }

    // Create an offscreen surface for this device
    let canvas = document.createElement("canvas");
    canvas.setAttribute('width', 0);
    canvas.setAttribute('height', 0);

    // Create the surface
    let newSurface = new Surface(canvas);

    // Technically, the surface is dimension-less and needs a bitmap created.
    // But, what can you do, we have the canvas there already.
    let handle = this.handles.allocate(newSurface);
    return handle;
}
