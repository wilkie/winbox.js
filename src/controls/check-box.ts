'use strict';

import { Window } from '../window.js';
import { Label } from './label.js';

export class CheckBox extends Window {
  declare _alignment: any;
  declare _checkBox: any;
  declare _checkBoxImg: any;
  declare _checkBoxSpan: any;
  declare _element: any;
  declare _label: any;
  declare _valignment: any;
  declare _value: any;
  declare static Value: any;
  declare static __checkedImage: any;
  declare static __grayedImage: any;
  declare static __uncheckedImage: any;
  declare static defaultOptions: any;
  constructor(options = {}) {
    options = Object.assign({}, CheckBox.defaultOptions, options);

    super(options);

    this.resize(100, 32);
    this.move(32, 32);
    this.alignment = 'left';
    this.verticalAlignment = 'center';
    this.value = CheckBox.Value.Unchecked;
  }

  initialize() {
    // Do normal creation
    super.initialize();

    // Generate checkbox images
    // Use an internal canvas
    if (!CheckBox.__checkedImage) {
      let canvas = document.createElement('canvas');
      canvas.setAttribute('width', String(13));
      canvas.setAttribute('height', String(13));

      let ctx = canvas.getContext('2d');
      let imageData = ctx.getImageData(0, 0, 13, 13);
      let data = imageData.data;
      for (var x = 0; x < 13; x++) {
        let position = x * 13 * 4;
        data[position + 0] = 0;
        data[position + 1] = 0;
        data[position + 2] = 0;
        data[position + 3] = 0xff;

        position = (x * 13 + 12) * 4;
        data[position + 0] = 0;
        data[position + 1] = 0;
        data[position + 2] = 0;
        data[position + 3] = 0xff;

        position = x * 4;
        data[position + 0] = 0;
        data[position + 1] = 0;
        data[position + 2] = 0;
        data[position + 3] = 0xff;

        position = (12 * 13 + x) * 4;
        data[position + 0] = 0;
        data[position + 1] = 0;
        data[position + 2] = 0;
        data[position + 3] = 0xff;
      }
      ctx.putImageData(imageData, 0, 0);
      CheckBox.__uncheckedImage = canvas.toDataURL('image/png');

      for (var x = 0; x < 13; x++) {
        let position = (x * 13 + x) * 4;
        data[position + 0] = 0;
        data[position + 1] = 0;
        data[position + 2] = 0;
        data[position + 3] = 0xff;

        position = (x * 13 + (13 - x - 1)) * 4;
        data[position + 0] = 0;
        data[position + 1] = 0;
        data[position + 2] = 0;
        data[position + 3] = 0xff;
      }
      ctx.putImageData(imageData, 0, 0);
      CheckBox.__checkedImage = canvas.toDataURL('image/png');

      canvas = document.createElement('canvas');
      canvas.setAttribute('width', String(13));
      canvas.setAttribute('height', String(13));

      ctx = canvas.getContext('2d');
      imageData = ctx.getImageData(0, 0, 13, 13);
      data = imageData.data;
      for (let y = 0; y < 11; y++) {
        for (var x = (y + 1) % 2; x < 11; x += 2) {
          const position = (y * 11 + x) * 4;
          data[position + 0] = 0;
          data[position + 1] = 0;
          data[position + 2] = 0;
          data[position + 3] = 0xff;
        }
      }

      for (var x = 0; x < 13; x++) {
        let position = x * 13 * 4;
        data[position + 0] = 0;
        data[position + 1] = 0;
        data[position + 2] = 0;
        data[position + 3] = 0xff;

        position = (x * 13 + 12) * 4;
        data[position + 0] = 0;
        data[position + 1] = 0;
        data[position + 2] = 0;
        data[position + 3] = 0xff;

        position = x * 4;
        data[position + 0] = 0;
        data[position + 1] = 0;
        data[position + 2] = 0;
        data[position + 3] = 0xff;

        position = (12 * 13 + x) * 4;
        data[position + 0] = 0;
        data[position + 1] = 0;
        data[position + 2] = 0;
        data[position + 3] = 0xff;
      }

      ctx.putImageData(imageData, 0, 0);
      CheckBox.__grayedImage = canvas.toDataURL('image/png');
    }

    // Add class
    this.element.classList.add('__winbox_checkbox');

    // Create the checkbox
    this._checkBox = document.createElement('input');
    this._checkBox.setAttribute('type', 'checkbox');
    this._element.append(this._checkBox);

    // Create the graphical part of the checkbox
    this._checkBoxSpan = document.createElement('span');
    this._checkBoxImg = document.createElement('img');
    this._checkBoxImg.src = '';
    this._checkBoxSpan.append(this._checkBoxImg);
    this._element.append(this._checkBoxSpan);

    // Create the label
    this._label = new Label(this.options);
    this.append(this._label);
    this._label.updateTag('label');
    this._label.move(0, 0);

    this.on('client-mousedown', () => {
      this.value = !this.value;
    });
  }

  resize(width, height) {
    super.resize(width, height);

    if (this._label) {
      this._label.resize(width, height);
    }
  }

  get value() {
    return this._value;
  }

  set value(value) {
    this._value = value;

    if (this._value == CheckBox.Value.Checked) {
      this._checkBoxImg.src = CheckBox.__checkedImage;
      this._checkBox.checked = true;
    } else if (this.value == CheckBox.Value.Indeterminate) {
      this._checkBox.indeterminate = true;
      this._checkBoxImg.src = CheckBox.__grayedImage;
    } else {
      this._checkBoxImg.src = '';
      this._checkBoxImg.src = CheckBox.__uncheckedImage;
      this._checkBox.checked = false;
    }
  }

  get options() {
    return super.options;
  }

  /**
   * Updates options with the given options.
   */
  set options(value) {
    super.options = value;

    this._label.options = value;
  }

  set alignment(value) {
    this._alignment = value;

    this._label.alignment = value;

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

    this._label.verticalAlignment = value;

    this.element.classList.remove('__winbox_valign-top');
    this.element.classList.remove('__winbox_valign-right');
    this.element.classList.remove('__winbox_valign-bottom');
    this.element.classList.add('__winbox_valign-' + value);
  }

  get verticalAlignment() {
    return this._valignment;
  }
}

CheckBox.Value = {
  Unchecked: 0,
  Checked: 1,
  Indeterminate: 2,
};

CheckBox.defaultOptions = {
  caption: 'CheckBox',
};

export default CheckBox;
