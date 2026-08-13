'use strict';

import { Window } from '../window.js';
import { BitmapFont } from '../raster/bitmap-font.js';

export class Label extends Window {
  declare _alignment: any;
  declare _border: any;
  declare _caption: any;
  declare _captionImage: any;
  declare _captionImageSpan: any;
  declare _color: any;
  declare _fitted: any;
  declare _measuredText: any;
  declare _options: any;
  declare _valignment: any;
  declare static defaultOptions: any;
  constructor(options = {}) {
    options = Object.assign({}, Label.defaultOptions, options);

    super(options);

    this.resize(100, 16);
    this.move(16, 16);
    this.alignment = 'left';
    this.verticalAlignment = 'top';
  }

  get options() {
    return super.options;
  }

  /**
   * Updates options with the given options.
   */
  set options(value) {
    super.options = value;

    this.caption = this.options.caption;
  }

  /**
   * Whether or not this always resizes to fit its contents.
   */
  get fitted() {
    return this._fitted;
  }

  set fitted(value) {
    this._fitted = value;

    if (this._fitted) {
      this.fit();
    }
  }

  /**
   * Resizes the window to fit its contents.
   */
  fit() {
    // Resize the label to fit the text metrics.
    if (this._measuredText) {
      this.resize(this._measuredText.width, this._measuredText.height);
    }
  }

  initialize() {
    // Do normal creation
    super.initialize();

    // It's a <span> tag
    this.updateTag('span');

    // Add class
    this.element.classList.add('__winbox_label');

    // Create caption
    this._caption = document.createElement('span');
    this._captionImageSpan = document.createElement('span');

    this._captionImage = document.createElement('img');
    this._captionImageSpan.appendChild(this._captionImage);
    this._captionImageSpan.style.display = 'none';

    // Print text
    this.element.appendChild(this._caption);
    this.element.appendChild(this._captionImageSpan);
  }

  get color() {
    return this._color;
  }

  set color(color) {
    this._color = color;
    this.container.style.color = color.css;
    this.options.color = color;
    // Re-run the caption setter so the label redraws in the new color.
    // eslint-disable-next-line no-self-assign
    this.caption = this.caption;
  }

  set border(value) {
    this._border = value;

    this.element.classList.remove('__winbox_border-solid');
    this.element.classList.add('__winbox_border-' + value);
  }

  get border() {
    return this._border;
  }

  set alignment(value) {
    this._alignment = value;

    this.element.classList.remove('__winbox_align-left');
    this.element.classList.remove('__winbox_align-right');
    this.element.classList.remove('__winbox_align-center');
    this.element.classList.add('__winbox_align-' + value);
  }

  get alignment() {
    return this._alignment;
  }

  set verticalAlignment(value) {
    this._valignment = value;

    this.element.classList.remove('__winbox_valign-top');
    this.element.classList.remove('__winbox_valign-right');
    this.element.classList.remove('__winbox_valign-bottom');
    this.element.classList.add('__winbox_valign-' + value);
  }

  get verticalAlignment() {
    return this._valignment;
  }

  get focusable() {
    return false;
  }

  get caption() {
    return this.options.caption;
  }

  set caption(value) {
    this.options.caption = value || '';

    const textValue = value.replace('&', '');

    if (this._options.font) {
      if (this._options.font instanceof BitmapFont) {
        const fonts = this._options.font;
        this._caption.style.display = 'none';
        this._captionImageSpan.style.display = 'inline';
        const font = fonts.fontFor(this._options.size || 10);
        let width = 0;
        if (!this.fitted) {
          width = this.width;
        }
        this._measuredText = font.measure(this._options.caption, {
          weight: this._options.weight,
          allowAnnotation: true,
        });
        this._captionImage.src = font.dataFor(this._options.caption, {
          color: this._options.color,
          weight: this._options.weight,
          width: width,
          allowAnnotation: true,
        });
        this._captionImage.setAttribute('alt', textValue);

        if (this.fitted) {
          this.fit();
        }
      }
    } else {
      this._caption.textContent = textValue;

      const captionClone = this._caption.cloneNode(true);
      document.body.appendChild(captionClone);

      captionClone.style.position = 'absolute';
      captionClone.style.whiteSpace = 'nowrap';

      this._measuredText = {
        width: captionClone.clientWidth + 2,
        height: captionClone.clientHeight,
      };

      captionClone.remove();

      if (this.fitted) {
        this.fit();
      }
    }

    if (this.fitted) {
      this.fit();
    }
  }
}

/**
 * The default options for a Label object.
 */
Label.defaultOptions = {
  caption: 'Label',
};

export default Label;
