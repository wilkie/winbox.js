"use strict"

// TODO: make a WinBox namespace.
import { Space } from './space.js';
import { Win16 } from './win16.js';

/* The stylesheets ship with the bundle, the way the webpack entry used to pair
 * ./src/shim.js with ./css/main.scss. Vite extracts them to dist/winbox.css.
 */
import '../css/main.scss';

declare global {
    interface Window {
        Space: typeof Space;
        Win16: typeof Win16;
    }
}

window.Space = Space;
window.Win16 = Win16;
