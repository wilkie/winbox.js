'use strict';

import { EventComponent } from './event-component.js';
import { Util } from './util.js';
import { ResizeBox } from './screen/resize-box.js';
import { DraggablePlane } from './screen/draggable-plane.js';
import { Color } from './raster/color.js';
import { Surface } from './raster/surface.js';
import { BitmapFont } from './raster/bitmap-font.js';

/**
 * This creates an element that emulates a Windows 3.1 window.
 *
 * Events: mousemove, mouseenter, mouseleave, mouseup, mousedown, nonclient-mousedown, nonclient-mouseup, client-mousedown, client-mouseup, client-drag, nonclient-drag,
 */
export class Window extends EventComponent {
  declare _backgroundColor: any;
  declare _canvas: any;
  declare _createStruct: any;
  declare _data: any;
  declare _disabled: any;
  declare _draggablePlane: any;
  declare _element: any;
  declare _eventsBound: any;
  declare _focused: any;
  declare _id: any;
  declare _inFocus: any;
  declare _itemEvents: any;
  declare _items: any;
  declare _keyRepeat: any;
  declare _lastMouseEvent: any;
  declare _lastMouseEventTime: any;
  declare _mover: any;
  declare _nonClient: any;
  declare _nonClientItems: any;
  declare _options: any;
  declare _parent: any;
  declare _resizeBox: any;
  declare _resizeBoxMouseUpEvent: any;
  declare _resizeBoxTarget: any;
  declare _root: any;
  declare _rootInitialized: any;
  declare _startX: any;
  declare _startY: any;
  declare _surface: any;
  declare _x: any;
  declare _y: any;
  declare static Docked: any;
  declare static Order: any;
  declare static __windowCount: any;
  declare static defaultOptions: any;
  constructor(options = {}) {
    super();

    this._options = Object.assign({}, Window.defaultOptions, options);

    Window.__windowCount++;
    this._id = Window.__windowCount;

    this._data = {};

    // References to children
    this._items = [];
    this._nonClientItems = [];
    this._nonClient = false;
    this._disabled = false;

    // References to bound events
    this._itemEvents = new Map();

    // Reference to parent
    this._parent = null;

    // Reference to the focused child
    this._focused = null;

    // State flags for this window
    this._inFocus = false;

    this._backgroundColor = new Color(255, 255, 255, 255);

    // Initialize
    this.initialize();
    this.bindEvents();
  }

  /* Hook for subclasses that filter client mouse events. See the FIXME in
   * controls/menu.ts: the override there calls super and nothing calls it. */
  _clientMouseEvent(name, data) {}

  /**
   * Returns whether or not this window is part of its parent's non-client area.
   */
  get detached() {
    return this._nonClient;
  }

  get id() {
    return this._id;
  }

  get data() {
    return this._data;
  }

  set data(value) {
    this._data = value;
  }

  get disabled() {
    return this._disabled;
  }

  set disabled(value) {
    this._disabled = value;
  }

  get options() {
    return this._options;
  }

  set options(value) {
    if (!value) {
      return;
    }

    this._options = Object.assign({}, value, this._options);

    // Throw options to children
    this._items.forEach((item) => {
      item.options = Object.assign({}, this._options[item.type] || this._options, item.options);
    });

    if (value.cursor) {
      this.cursor = value.cursor;
    }
  }

  get cursor() {
    return this.options.cursor;
  }

  set cursor(value) {
    this.options.cursor = value;

    const fallback = this.options.cursorFallback || 'pointer';

    if (value) {
      this.element.style.cursor = `url('${value}'), ${fallback}`;
    }
  }

  /**
   * Returns whether or not this window is in focus.
   */
  get focused() {
    return this._inFocus;
  }

  get type() {
    return 'window';
  }

  /**
   * Returns the window this item is currently placed within.
   */
  get parent() {
    return this._parent;
  }

  /**
   * Returns the space this item is located within.
   */
  get root() {
    if (this._root) {
      return this._root;
    }

    if (this.parent) {
      return this.parent.root;
    }

    return undefined;
  }

  /**
   * Returns a list of items within the window in no particular order.
   */
  get items() {
    return this._items.slice();
  }

  get element() {
    return this._element;
  }

  get container() {
    return this.element;
  }

  get canvas() {
    return this._canvas;
  }

  get nonClientCanvas() {
    return this._canvas;
  }

  get surface() {
    if (!this._surface) {
      this._surface = new Surface(this.canvas);
    }
    return this._surface;
  }

  get nonClientSurface() {
    return new Surface(this.nonClientCanvas);
  }

  /**
   * This will replace the representing DOM element with a different tag.
   */
  updateTag(tag) {
    this._element = Util.replaceTag(this._element, tag);

    // We will have to rebind the generic events
    this._eventsBound = false;
    this.bindEvents();
  }

  /**
   * Returns the client-area-relative X coordinate of the window.
   */
  get x() {
    return this._x;
  }

  /**
   * Returns the client-area-relative Y coordinate of the window.
   */
  get y() {
    return this._y;
  }

  /**
   * Returns the parent-relative X coordinate of the window.
   */
  get outerX() {
    let x = this.x;

    if (this.parent) {
      x += this.parent.innerX;
    }

    return x;
  }

  /**
   * Returns the parent-relative Y coordinate of the window.
   */
  get outerY() {
    let y = this.y;

    if (this.parent) {
      y += this.parent.innerY;
    }

    return y;
  }

  /**
   * Returns the space-relative X coordinate of the window.
   */
  get spaceX() {
    let x = this.outerX;

    if (this.parent) {
      x += this.parent.spaceX;
    }

    return x;
  }

  /**
   * Returns the space-relative Y coordinate of the window.
   */
  get spaceY() {
    let y = this.outerY;

    if (this.parent) {
      y += this.parent.spaceY;
    }

    return y;
  }

  /**
   * Returns the relative X coordinate of the client-area's (0, 0) origin.
   *
   * Typically that will be simply 0, but the client area may be padded with a
   * border or some decoration which will increase that number.
   *
   * This measures the space taken up by a decoration or border.
   */
  get innerX() {
    if (this.container === this.element) {
      return this.element.clientLeft;
    }

    return this.container.offsetLeft + this.container.clientLeft + this.element.clientLeft;
  }

  /**
   * Returns the relative Y coordinate of the client-area's (0, 0) origin.
   *
   * Typically that will be simply 0, but the client area may be padded with a
   * border or some decoration which will increase that number.
   *
   * This measures the space taken up by a decoration or border.
   */
  get innerY() {
    if (this.container === this.element) {
      return this.element.clientTop;
    }

    return this.container.offsetTop + this.container.clientTop + this.element.clientTop;
  }

  /**
   * Returns the client area width.
   */
  get innerWidth() {
    return this.container.offsetWidth;
  }

  /**
   * Returns the client area height.
   */
  get innerHeight() {
    return this.container.offsetHeight;
  }

  get width() {
    return this.element.offsetWidth;
  }

  get height() {
    return this.element.offsetHeight;
  }

  get backgroundColor() {
    return this._backgroundColor;
  }

  set backgroundColor(color) {
    this._backgroundColor = color;
    this.container.style.backgroundColor = color.css;
  }

  /**
   * Modifies the z-order of the given child item.
   */
  reorder(item, order = Window.Order.Top) {
    // The window that is responsible for painting the windows must reorder
    if (item._manager && item._manager !== this) {
      return item._manager.reorder(item, order);
    }

    if (item.element.parentNode != this.container) {
      return;
    }

    if (order == Window.Order.Top) {
      if (this._resizeBox) {
        this.container.insertBefore(item.element, this._resizeBox.element);
      } else {
        this.container.appendChild(item.element);
      }
    } else if (order == Window.Order.Bottom) {
      this.container.insertBefore(item.element, this.container.children[0]);
    }
  }

  /**
   * Appends a child to this window, if possible.
   */
  append(item, nonClient = false, onlyPaint = false) {
    // If we are the root window, ensure some initialization happens
    if (this._root === this) {
      if (!this._rootInitialized) {
        this._rootInitialized = true;
        this._rootInitialize();
      }
    }

    if (item === this) {
      return;
    }

    if (item.parent === this) {
      return;
    }

    if (item.parent && !onlyPaint) {
      item.parent.remove(item);
    }

    // Create the resizing box, if we now need one
    if (item.movable || item.resizable) {
      if (!this._resizeBox) {
        const resizeBox = new ResizeBox();
        this._resizeBox = resizeBox;
        this._resizeBox.on('mouseup', (event) => {
          this._resizeBoxMouseUpEvent = event;
        });
        this.container.appendChild(this._resizeBox.element);
      }
    }

    if (nonClient) {
      this.element.appendChild(item.element);
    } else if (this._resizeBox) {
      this.container.insertBefore(item.element, this._resizeBox.element);
    } else {
      this.container.appendChild(item.element);
    }

    item._manager = this;

    if (onlyPaint) {
      return;
    }

    item.options = Object.assign({}, this._options[item.type] || this._options, item.options);
    if (nonClient) {
      item._nonClient = true;
      this._nonClientItems.push(item);
    } else {
      this._items.push(item);
    }
    item._parent = this;

    // Item events
    this._itemEvents.set(item, []);
    const itemEvents = this._itemEvents.get(item);

    // Capture the focus event for an item
    itemEvents.push(['focus', this._itemFocusEvent.bind(this, item)]);

    // Capture the movement requests from the item
    itemEvents.push(['move-start', this._itemMoveStartEvent.bind(this, item)]);
    itemEvents.push(['move-drag', this._itemMoveDragEvent.bind(this, item)]);
    itemEvents.push(['move-end', this._itemMoveEndEvent.bind(this, item)]);

    // Capture resize requests of items
    [
      'left',
      'right',
      'top',
      'bottom',
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
    ].forEach((direction) => {
      itemEvents.push([
        'resize-' + direction + '-start',
        this._itemResizeStartEvent.bind(this, item, direction),
      ]);
      itemEvents.push([
        'resize-' + direction + '-drag',
        this._itemResizeDragEvent.bind(this, item, direction),
      ]);
      itemEvents.push([
        'resize-' + direction + '-end',
        this._itemResizeEndEvent.bind(this, item, direction),
      ]);
    });

    // Actually bind the events
    itemEvents.forEach((info) => {
      item.on(info[0], info[1]);
    });

    // Trigger the load event for the item
    item.trigger('load');
  }

  /**
   * Removes this item from wherever it is.
   */
  destroy() {
    if (this.parent) {
      this.parent.remove(this);
      this.trigger('blur');
    }
  }

  /**
   * Removes an item from this window.
   */
  remove(item) {
    // When a different window manages the painting/events of the window
    if (item._manager && item._manager !== this) {
      // We need to remove it from there too
      item._manager.remove(item);
    }

    try {
      this.container.removeChild(item.element);
    } catch (e) {}

    const index = this._items.indexOf(item);
    if (index < 0) {
      return;
    }

    // Remove item event handlers
    (this._itemEvents.get(item) || []).forEach((info) => {
      item.off(info[0], info[1]);
    });
    this._itemEvents.set(item, []);

    if (item._manager === this) {
      item._manager = null;
    }

    this._items.splice(index, 1);

    if (item._parent === this) {
      item._parent = null;
      item.trigger('unload');
    }
  }

  get visible() {
    return this.element.style.display !== 'none';
  }

  get maximized() {
    return this.element.classList.contains('__winbox_window-maximized');
  }

  maximize() {
    this.element.classList.add('__winbox_window-maximized');
  }

  get minimized() {
    return this.element.classList.contains('__winbox_window-minimized');
  }

  minimize() {
    this.element.classList.add('__winbox_window-minimize');
  }

  restore() {
    this.element.classList.remove('__winbox_window-minimize');
    this.element.classList.remove('__winbox_window-maximize');
  }

  show() {
    this.element.style.display = '';
    this.element.setAttribute('aria-hidden', 'false');

    if (this.canvas) {
      this.canvas.setAttribute('width', this.canvas.clientWidth);
      this.canvas.setAttribute('height', this.canvas.clientHeight);
    }
  }

  hide() {
    this.element.style.display = 'none';
    this.element.setAttribute('aria-hidden', 'true');
  }

  /**
   * Whether or not the window is currently movable.
   */
  get movable() {
    return false;
  }

  /**
   * Whether or not the window is resizable.
   */
  get resizable() {
    return false;
  }

  /**
   * Whether or not the window can receive focus.
   */
  get focusable() {
    return true;
  }

  /**
   * Whether or not this is docked to its parent.
   */
  get docked() {
    return false;
  }

  /**
   * Focuses on this window, if possible.
   */
  focus() {
    if (this.parent) {
      this.parent.focus();
    }

    if (this.focusable && this._inFocus == false) {
      this.trigger('focus');
    }
  }

  /**
   * Moves the window to the specified place.
   */
  move(x, y) {
    this._x = x;
    this._y = y;
    this.element.style.left = 0.0625 * x + 'rem';
    this.element.style.top = 0.0625 * y + 'rem';
  }

  /**
   * Moves the window to the center of its parent container.
   */
  center() {
    if (this.parent) {
      const x = (this.parent.innerWidth - this.width) / 2;
      const y = (this.parent.innerHeight - this.height) / 2;

      this.move(x, y);
    }
  }

  /**
   * Resizes the window to fit its contents.
   */
  fit() {
    let width = 0;
    let height = 0;

    // The default behavior is to fit it to the items inside.
    this.items.forEach((item) => {
      width = Math.max(width, item.x + item.width);
      height = Math.max(height, item.y + item.height);
    });

    this.resize(width, height);
  }

  /**
   * Resizes the window to the given dimensions.
   */
  resize(width, height) {
    if (this.docked != Window.Docked.Top && this.docked != Window.Docked.Bottom) {
      this.element.style.width = 0.0625 * width + 'rem';
    }

    if (this.docked != Window.Docked.Left && this.docked != Window.Docked.Right) {
      this.element.style.height = 0.0625 * height + 'rem';
    }

    if (this.canvas) {
      this.canvas.setAttribute('width', this.canvas.clientWidth);
      this.canvas.setAttribute('height', this.canvas.clientHeight);
    }

    this.trigger('resize');
  }

  _rootInitialize() {
    this._draggablePlane = new DraggablePlane(this.element);
  }

  initialize() {
    // Create the window element
    this._element = document.createElement('div');
    this._element.classList.add('__winbox_window');

    // Create the canvas element for the client area
    this._canvas = document.createElement('canvas');
    this._canvas.classList.add('__winbox_canvas');
    this._element.appendChild(this._canvas);

    // Move
    this.move(0, 0);

    // Resize
    this.resize(250, 250);

    this.on('focus', () => {
      if (!this._inFocus) {
        this._inFocus = true;

        // Focus on the previously focused children
        if (this._focused) {
          this._focused.focus();
        }
      }
    });

    this.on('blur', () => {
      this._inFocus = false;

      // Blur the children
      if (this._focused) {
        this._focused.element.classList.remove('__winbox_focused');
        this._focused.trigger('blur');
        this._focused = null;
      }
    });
  }

  bindEvents() {
    if (this._eventsBound) {
      return;
    }

    this._eventsBound = true;

    // Disable browser context menu (right-click, usually) from popping up
    this.element.addEventListener('contextmenu', (event) => {
      event.preventDefault();
    });

    // Add normal events
    this.element.addEventListener('mousedown', this.mouseDownEvent.bind(this));
    this.element.addEventListener('mousemove', this.mouseMoveEvent.bind(this));
    this.element.addEventListener('mouseup', this.mouseUpEvent.bind(this));
    this.element.addEventListener('mouseenter', this.mouseEnterEvent.bind(this));
    this.element.addEventListener('mouseleave', this.mouseLeaveEvent.bind(this));
    this.element.addEventListener('keydown', this.keyDownEvent.bind(this));
    this.element.addEventListener('keyup', this.keyUpEvent.bind(this));
  }

  _itemFocusEvent(item, event) {
    if (!item.focusable) {
      return;
    }

    // And then ignore reordering, etc, if this item is already in focus
    if (this._focused === item) {
      return;
    }

    // Blur the last focused item
    if (this._focused) {
      this._focused.element.classList.remove('__winbox_focused');
      this._focused.trigger('blur');
    }

    this._focused = item;
    item.element.classList.add('__winbox_focused');
  }

  _itemResizeStartEvent(item, direction, event) {
    this._resizeBoxTarget = item;
    if (this._resizeBox) {
      this._resizeBox.move(item.x, item.y);
      this._resizeBox.resize(item.element.offsetWidth, item.element.offsetHeight);
      this._resizeBox.show();
    }
  }

  _itemResizeDragEvent(item, direction, event) {
    if (this._resizeBox) {
      let x1 = this._resizeBox.x;
      let y1 = this._resizeBox.y;
      let x2 = x1 + this._resizeBox.width;
      let y2 = y1 + this._resizeBox.height;

      // Depending on the direction, only certain edges move
      if (direction.indexOf('left') >= 0) {
        x1 = event.to.x; // Move x1 to event
      }
      if (direction.indexOf('top') >= 0) {
        y1 = event.to.y; // Move y1 to event
      }
      if (direction.indexOf('right') >= 0) {
        x2 = event.to.x + item.element.offsetWidth;
      }
      if (direction.indexOf('bottom') >= 0) {
        y2 = event.to.y + item.element.offsetHeight;
      }

      this._resizeBox.move(x1, y1);
      this._resizeBox.resize(x2 - x1, y2 - y1);
    }
  }

  _itemResizeEndEvent(item, direction, event) {
    if (this._resizeBox) {
      const paddingX = item.width - item.element.offsetWidth;
      const paddingY = item.height - item.element.offsetHeight;
      this._resizeBox.hide();
      // Make sure the mouseup event happens under the resize box
      // but after the drag/resize events happen.
      this._resizeBoxTarget.trigger('mouseup', event);
      item.move(this._resizeBox.x, this._resizeBox.y);
      item.resize(this._resizeBox.width + paddingX, this._resizeBox.height + paddingY);
    }
  }

  _itemMoveStartEvent(item, event) {
    this._resizeBoxTarget = item;
    if (this._resizeBox) {
      this._resizeBox.move(item.x, item.y);
      this._resizeBox.resize(item.element.offsetWidth, item.element.offsetHeight);
      this._resizeBox.show();
    }
  }

  _itemMoveDragEvent(item, event) {
    this._resizeBoxTarget = item;
    // Move resize box (if specified to do so)
    if (this._resizeBox) {
      this._resizeBox.move(event.to.x, event.to.y);
    }
  }

  _itemMoveEndEvent(item, event) {
    this._resizeBoxTarget = item;
    if (this._resizeBox) {
      this._resizeBox.hide();
      // Make sure the mouseup event happens under the resize box
      // but after the drag/resize events happen.
      this._resizeBoxTarget.trigger('mouseup', event);
      item.move(this._resizeBox.x, this._resizeBox.y);
    }
  }

  /**
   * Handles keydown events on the window.
   */
  keyDownEvent(event) {
    event.stopPropagation();
    if (event.repeat) {
      this._keyRepeat++;
    } else {
      this._keyRepeat = 0;
    }

    const data = {
      key: event.key,
      code: event.code,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      repeat: this._keyRepeat,
    };

    this.trigger('keydown', data);
    this._clientEvent('keydown', data);
  }

  keyUpEvent(event) {
    event.stopPropagation();

    const data = {
      key: event.key,
      code: event.code,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
    };

    this.trigger('keyup', data);
    this._clientEvent('keyup', data);
  }

  /**
   * Handles click events on the window.
   */
  mouseDownEvent(event) {
    event.stopPropagation();

    const data = {
      x: event.offsetX,
      y: event.offsetY,
      clicks: 1,
      button: event.button,
      buttons: event.buttons,
      shift: event.shiftKey,
      control: event.controlKey,
      alt: event.altKey,
    };

    if (this._lastMouseEvent) {
      if (
        data.x >= this._lastMouseEvent.x - 3 &&
        data.y >= this._lastMouseEvent.y - 3 &&
        data.x <= this._lastMouseEvent.x + 3 &&
        data.y <= this._lastMouseEvent.y + 3
      ) {
        if (event.timeStamp - this._lastMouseEventTime < 500) {
          data.clicks = this._lastMouseEvent.clicks + 1;
        }
      }
    }

    this._lastMouseEvent = Object.assign({}, data);
    this._lastMouseEventTime = event.timeStamp;

    if (this.callbacksFor('drag')) {
      if (this.root) {
        this.root._draggablePlane.track(
          event,
          this.moveDragEvent.bind(this),
          this.moveDragEndEvent.bind(this)
        );
      }
    } else {
      // Don't allow other events outside bounds (and ignore drag events)
      const box = this.element.getBoundingClientRect();
      if (this.root) {
        this.root._draggablePlane.mask(box, this.moveDragEndEvent.bind(this));
      }
    }

    this.trigger('mousedown', data);
    this._clientEvent('mousedown', data);

    this._startX = this.x;
    this._startY = this.y;

    this.focus();
  }

  nonClientMouseDownEvent(event) {
    if (event.stopPropagation) {
      event.stopPropagation();
    }

    const data = {
      x: event.offsetX,
      y: event.offsetY,
      clicks: 1,
      button: event.button,
      buttons: event.buttons,
      shift: event.shiftKey,
      control: event.controlKey,
      alt: event.altKey,
    };

    if (this._lastMouseEvent) {
      if (
        data.x >= this._lastMouseEvent.x - 3 &&
        data.y >= this._lastMouseEvent.y - 3 &&
        data.x <= this._lastMouseEvent.x + 3 &&
        data.y <= this._lastMouseEvent.y + 3
      ) {
        if (event.timeStamp - this._lastMouseEventTime < 500) {
          data.clicks = this._lastMouseEvent.clicks + 1;
        }
      }
    }

    this._lastMouseEvent = Object.assign({}, data);
    this._lastMouseEventTime = event.timeStamp;

    if (this.callbacksFor('drag')) {
      if (this.root) {
        this.root._draggablePlane.track(
          event,
          this.moveDragEvent.bind(this),
          this.moveDragEndEvent.bind(this)
        );
      }
    } else {
      // Don't allow other events outside bounds (and ignore drag events)
      const box = this.element.getBoundingClientRect();
      if (this.root) {
        this.root._draggablePlane.mask(box, this.moveDragEndEvent.bind(this));
      }
    }

    this.trigger('nonclient-mousedown', data);
    this._nonClientEvent('mousedown', data);

    this._startX = this.x;
    this._startY = this.y;

    this.focus();
  }

  _clientEvent(name, data) {
    if (!data.target) {
      data.target = {};
      data.target.window = this;
      data.target.x = data.x;
      data.target.y = data.y;
    }

    if (name === 'mouseup') {
      if (this.root) {
        this.root._draggablePlane.unmask();
      }
    }

    this.trigger('client-' + name, data);

    if (this.parent) {
      // Determine new x, y
      data.x = data.target.window.innerX + data.x + data.target.window.x;
      data.y = data.target.window.innerY + data.y + data.target.window.y;

      if (this.detached) {
        this.parent._nonClientEvent(name, data);
      } else {
        this.parent._clientEvent(name, data);
      }
    }
  }

  _nonClientEvent(name, data) {
    if (name === 'mouseup') {
      if (this._mover) {
        const mover = this._mover;
        this._mover = null;
        mover._stop(event);
      }
    }

    this.trigger('nonclient-' + name, data);

    if (this.parent) {
      if (!data.target) {
        data.target = {};
        data.target.window = this;
        data.target.x = data.x;
        data.target.y = data.y;
      }

      // Determine new x, y
      data.x = data.target.window.innerX + data.x + data.target.window.x;
      data.y = data.target.window.innerY + data.y + data.target.window.y;

      if (this.detached) {
        this.parent._nonClientEvent(name, data);
      } else {
        this.parent._clientEvent(name, data);
      }
    }
  }

  mouseMoveEvent(event) {
    if (event.stopPropagation) {
      event.stopPropagation();
    }

    const data = {
      x: event.offsetX,
      y: event.offsetY,
      button: event.button,
      buttons: event.buttons,
      shift: event.shiftKey,
      control: event.controlKey,
      alt: event.altKey,
    };

    this.trigger('mousemove', data);
  }

  /**
   * Handles mouseup events on the window.
   */
  mouseUpEvent(event) {
    if (event.stopPropagation) {
      event.stopPropagation();
    }

    const data = {
      x: event.offsetX,
      y: event.offsetY,
      clicks: 1,
      button: event.button,
      buttons: event.buttons,
      shift: event.shiftKey,
      control: event.controlKey,
      alt: event.altKey,
    };

    this.trigger('mouseup', data);
    this._clientEvent('mouseup', data);
  }

  /**
   * Handles mouseenter events on the window.
   */
  mouseEnterEvent(event) {
    this.trigger('mouseenter', event);
  }

  /**
   * Handles mouseleave events on the window.
   */
  mouseLeaveEvent(event) {
    this.trigger('mouseleave', event);
  }

  /**
   * Handles when the element should be moved.
   */
  moveDragEvent(event) {
    event.to = {};
    event.to.x = this._startX + event.delta.x;
    event.to.y = this._startY + event.delta.y;

    const data = {
      x: event.x - this.spaceX,
      y: event.y - this.spaceY,
      delta: {
        x: event.delta.x,
        y: event.delta.y,
      },
    };

    this.trigger('drag', data);
    this._clientEvent('drag', data);
  }

  /**
   * Handles when the element should be done moving.
   */
  moveDragEndEvent(event) {
    const data: any = {
      x: event.x,
      y: event.y,
    };

    data.to = {};
    data.to.x = this._startX + event.delta.x;
    data.to.y = this._startY + event.delta.y;

    this.trigger('drag-end', data);
    this._clientEvent('drag-end', data);
    this._element.classList.remove('__winbox_dragging');
    this.mouseUpEvent(event);
  }

  trigger(name, data?): any {
    super.trigger(name, data);

    if (name == 'signal') {
      if (this.parent) {
        this.parent.trigger(name, data);
      }
    }
  }
}

/**
 * The default options for a Window object.
 */
Window.defaultOptions = {
  caption: 'Window',
  cursor: 'POINTER.CUR',
  cursorFallback: 'pointer',
};

/**
 * Possible values for docking windows to their parents.
 */
Window.Docked = {
  Top: 1,
  Left: 2,
  Right: 3,
  Bottom: 4,
};

/**
 * Possible z-order options.
 */
Window.Order = {
  Top: 1,
  Bottom: 2,
};

Window.__windowCount = 0;

export default Window;
