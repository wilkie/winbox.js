'use strict';

import { Ditherer } from './raster/ditherer.js';
import { Color } from './raster/color.js';
import { Win16 } from './win16.js';

export class WinBox {
  declare _backgroundCanvas: any;
  declare _container: any;
  declare _ditherer: any;
  declare _options: any;
  declare _resizeBox: any;
  declare static defaultOptions: any;
  constructor(options = {}) {
    this._options = Object.assign({}, WinBox.defaultOptions, options);

    this._ditherer = new Ditherer();
  }

  /**
   * Creates and starts the simulation within the given element.
   */
  open(element) {
    // Create containing element
    const container = document.createElement('div');
    container.classList.add('winbox');

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.classList.add('__winbox_canvas');

    // Add the background canvas to the container
    container.appendChild(canvas);

    // Add the container to the element
    element.appendChild(container);

    // Size the canvas
    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;
    canvas.setAttribute('width', String(width));
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
  }

  /**
   * Appends a child to this window, if possible.
   */
  append(item) {
    this._container.insertBefore(item.element, this._resizeBox.element);
    item.options = this._options[item.type];
  }

  /**
   * Retrieves the canvas used to render the background.
   */
  get backgroundCanvas() {
    return this._backgroundCanvas;
  }

  /**
   * Redraws the background.
   */
  drawBackground() {}
}

/**
 * The default options for a WinBox object.
 */
WinBox.defaultOptions = {
  padding: {
    left: 10,
    right: 10,
    bottom: 10,
    top: 10,
  },
  background: {
    color: {
      gradient: [0x0000ff, 0x000000],
    },
  },
  window: {
    font: 'VGASYS.FON',
    button: {
      font: 'VGASYS.FON',
    },
  },
  font: '3rem Arial Black',
  title: 'Hello World',
};

export default WinBox;
