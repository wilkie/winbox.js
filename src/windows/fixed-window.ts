'use strict';

import { Window } from '../window.js';
import { Button } from '../controls/button.js';
import { SubMenu, Menu } from '../controls/menu.js';
import { BitmapFont } from '../raster/bitmap-font.js';

export class SystemSubMenu extends SubMenu {}

export class SystemMenu extends Menu {
  declare _button: any;
  declare _ncMouseDown: any;
  declare _ncMouseUp: any;
  declare _subWindow: any;
  initialize() {
    super.initialize();

    this.updateTag('div'); // Make it NOT a <nav>

    // Add a specific class
    this.element.querySelector('button').classList.add('__winbox_close-button');

    this._button.show();
    this._button.on('mousedown', (event) => {
      //this._ncMouseDown = true;
      //this.options._window.trigger("nonclient-mousedown", event);
    });

    this.parent.on('blur', (event) => {
      this._subWindow.trigger('blur');
    });

    // Create the dropdown menu window
    const subWindow = new SystemSubMenu({ caption: 'SUBMENU-' + this.options.caption });
    let blurring = false;
    // Override behavior to not close when system button is clicked
    subWindow.on('blur', () => {
      if (!blurring) {
        if (this._ncMouseDown || this._ncMouseUp) {
          this._ncMouseDown = false;
          this._ncMouseUp = false;
          return;
        }
        blurring = true;
        this.trigger('blur');
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
    const parent = this.options._window;
    const titleBar = parent._titleBar;
    const windowX = parent.element.clientLeft;
    const titleBarX = titleBar.offsetLeft + titleBar.clientLeft;
    const elementX = this.element.offsetLeft + this.element.clientLeft;
    return this.options._window.spaceX + windowX + titleBarX + elementX;
  }

  get spaceY() {
    const parent = this.options._window;
    const titleBar = parent._titleBar;
    const windowY = parent.element.clientTop;
    const titleBarY = titleBar.offsetTop + titleBar.clientTop;
    const elementY = this.element.offsetTop + this.element.clientTop;
    const elementH = this.element.offsetHeight;
    return this.options._window.spaceY + windowY + titleBarY + elementY + elementH + 1;
  }
}

export class FixedWindow extends Window {
  declare _caption: any;
  declare _captionImage: any;
  declare _captionImageSpan: any;
  declare _closeButton: any;
  declare _container: any;
  declare _containerCanvas: any;
  declare _controlBoxVisible: any;
  declare _element: any;
  declare _options: any;
  declare _titleBar: any;
  declare _titleBarClicked: any;
  declare _topDock: any;
  declare caption: any;
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

    const caption = this._caption;
    const captionImageSpan = this._captionImageSpan;
    const captionImage = this._captionImage;

    this._closeButton.options = this._options.menu || this._options;

    if (this._options.font instanceof BitmapFont) {
      const font = this._options.font;
      caption.style.display = 'none';
      captionImageSpan.style.display = 'block';
      captionImage.src = font.fontFor(this._options.size || 10).dataFor(this._options.caption);
      captionImage.setAttribute('alt', caption.textContent);
    }

    this._caption.textContent = this._options.caption;
  }

  get controlBox() {
    return this._controlBoxVisible;
  }

  set controlBox(value) {
    this._controlBoxVisible = value;
    if (this._controlBoxVisible) {
      this._closeButton.show();
    } else {
      this._closeButton.hide();
    }
  }

  get container() {
    return this._container;
  }

  get canvas() {
    return this._containerCanvas;
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
    } else {
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
    this.element.classList.add('__winbox_window-fixed');

    // Create title bar
    this._titleBar = document.createElement('h2');
    this._titleBar.classList.add('__winbox_title-bar');

    // Create close button (which is actually a menu)
    const systemMenuOptions = Object.assign({}, this.options, {
      caption: 'System Menu',
      _window: this,
    });
    this._closeButton = new SystemMenu(systemMenuOptions);
    this._closeButton.resize(this._closeButton.width, 18);
    this._closeButton.append(new Menu({ caption: 'Restore' }));
    this._closeButton.append(new Menu({ caption: 'Move' }));
    this._closeButton.append(new Menu({ caption: 'Size' }));
    this._closeButton.append(new Menu({ caption: 'Minimize' }));
    this._closeButton.append(new Menu({ caption: 'Maximize' }));
    this._closeButton.append(new Menu({ caption: '-' }));
    const mnuClose = new Menu({ caption: 'Close' });
    this._closeButton.append(mnuClose);
    this._closeButton.append(new Menu({ caption: '-' }));
    this._closeButton.append(new Menu({ caption: 'Switch To...' }));

    mnuClose.on('click', (event) => {
      this.destroy();
    });

    // Append to document
    this._titleBar.appendChild(this._closeButton.element);
    this._element.appendChild(this._titleBar);

    // Create window caption
    const caption = document.createElement('span');
    caption.textContent = this._options.caption;
    this._caption = caption;
    this._titleBar.appendChild(caption);

    const captionImageSpan = document.createElement('span');
    captionImageSpan.style.display = 'none';
    const captionImage = document.createElement('img');
    this._captionImageSpan = captionImageSpan;
    this._captionImage = captionImage;
    captionImageSpan.appendChild(captionImage);
    this._titleBar.appendChild(captionImageSpan);

    // Create the top docking section which will contain menus etc.
    this._topDock = document.createElement('div');
    this._topDock.classList.add('__winbox_container');
    this._topDock.classList.add('__winbox_docked-container');

    // Append to document
    this._element.appendChild(this._topDock);

    // Create window content container
    this._container = document.createElement('div');
    this._container.classList.add('__winbox_container');
    this._containerCanvas = document.createElement('canvas');
    this._containerCanvas.classList.add('__winbox_canvas');
    this._container.appendChild(this._containerCanvas);
    this._container.setAttribute('tabindex', '-1');

    this._container.addEventListener('keydown', this.keyDownEvent.bind(this));
    this._container.addEventListener('keyup', this.keyUpEvent.bind(this));

    // Append to document
    this._element.appendChild(this._container);

    this.on('focus', (event) => {
      // Bring ourselves to the top, please
      if (this.parent) {
        this.parent.reorder(this, Window.Order.Top);
      }
    });

    this.on('nonclient-mousedown', (data) => {
      if (this._titleBarClicked) {
        if (this.movable) {
          this.trigger('move-start', data);
        }
      }
    });

    this.on('drag', (data) => {
      if (this._titleBarClicked) {
        if (this.movable) {
          data.to = {};
          data.to.x = this.x + data.delta.x;
          data.to.y = this.y + data.delta.y;
          this.trigger('move-drag', data);
        }
      }
    });

    this.on('drag-end', (data) => {
      if (this._titleBarClicked) {
        this.trigger('move-end', data);
        this._titleBarClicked = false;
      }
    });

    this.on('nonclient-mouseup', (event) => {
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

    this._closeButton.on('mousedown', (event) => {
      if (event.clicks == 2) {
        this.destroy();
      }
      this._closeButton._ncMouseDown = true;
      this.nonClientMouseDownEvent(event);
    });

    this._closeButton.on('mouseup', (event) => {
      this.nonClientMouseDownEvent(event);
    });
  }
}

export default FixedWindow;
