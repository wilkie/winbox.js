'use strict';

import { User, MSG } from './user.js';

import { GetTickCount } from './user/GetTickCount.js';
import { SetFocus } from './user/SetFocus.js';

export class WindowManager {
  declare _halts: any;
  declare _handles: any;
  declare _scheduler: any;
  declare _startTime: any;
  constructor(scheduler, handles, startTime) {
    this._scheduler = scheduler;
    this._handles = handles;
    this._startTime = startTime;
    this._halts = {};
  }

  register(taskHandle, task, hWnd, windowInstance) {
    const data = windowInstance.data;
    data.hWnd = hWnd;
    data.hInstance = taskHandle;
    windowInstance.data = data;

    // Capture events
    [
      'client-mousedown',
      'client-mouseup',
      'mousemove',
      'focus',
      'client-keydown',
      'client-keyup',
    ].forEach((event) => {
      windowInstance.on(event, (data) => {
        this.createMessage(taskHandle, task, hWnd, event, data);
      });
    });
  }

  /**
   * Specifies that all focus is demanded by the given child window.
   */
  halt(hWnd, childhWnd) {
    this._halts[hWnd] = childhWnd;
  }

  /**
   * Crafts a message for the given event and pushes it to the given task.
   */
  createMessage(taskHandle, task, hWnd, event, data, callback?) {
    const messages = [];

    // Get the window itself
    const dialog = this._handles.resolve(hWnd);

    // Get the window/class for the handle
    const windowClass = this._handles.retrieve(dialog.options.windowClass);

    const msg = new MSG();
    msg.hwnd = hWnd;
    msg.callback = callback;

    if (event === 'mousemove') {
      msg.message = User.WM_MOUSEMOVE;
      msg.wParam = 0;

      // Set flags
      if (data.buttons & 1) {
        msg.wParam |= User.MK_LBUTTON;
      }
      if (data.buttons & 2) {
        msg.wParam |= User.MK_RBUTTON;
      }
      if (data.buttons & 4) {
        msg.wParam |= User.MK_MBUTTON;
      }
      if (data.shift) {
        msg.wParam |= User.MK_SHIFT;
      }
      if (data.control) {
        msg.wParam |= User.MK_CONTROL;
      }

      // Set position
      msg.lParam = (data.x & 0xffff) | ((data.y & 0xffff) << 16);

      messages.push(msg);
    } else if (event === 'client-keydown' || event === 'client-keyup') {
      // Get the proper message
      if (event === 'client-keydown') {
        msg.message = User.WM_KEYDOWN;
      } else {
        msg.message = User.WM_KEYUP;
      }

      // Set keycode
      let code = data.code;
      if (code == 'Numpad5') {
        if (data.key == 'Clear') {
          code = data.key;
        }
      } else if (code >= 'KeyA' && code <= 'KeyZ') {
        code = data.code.slice(3).charCodeAt(0);
      }

      // Translate the key
      msg.wParam = User.VIRTUAL_KEY_TRANSLATE[code] || code;

      // Set flags
      msg.lParam = event.repeat & 0xffff;

      if (msg.wParam) {
        messages.push(msg);
      }
    } else if (event === 'client-mousedown' || event === 'client-mouseup') {
      // Get the proper message
      if (event === 'client-mousedown') {
        if (data.clicks == 2) {
          msg.message = [User.WM_LBUTTONDBLCLK, User.WM_MBUTTONDBLCLK, User.WM_RBUTTONDBLCLK][
            data.button
          ];
        } else {
          msg.message = [User.WM_LBUTTONDOWN, User.WM_MBUTTONDOWN, User.WM_RBUTTONDOWN][
            data.button
          ];
        }
      } else {
        msg.message = [User.WM_LBUTTONUP, User.WM_MBUTTONUP, User.WM_RBUTTONUP][data.button];
      }

      // Set flags
      if (data.buttons & 1) {
        msg.wParam |= User.MK_LBUTTON;
      }
      if (data.buttons & 2) {
        msg.wParam |= User.MK_RBUTTON;
      }
      if (data.buttons & 4) {
        msg.wParam |= User.MK_MBUTTON;
      }
      if (data.shift) {
        msg.wParam |= User.MK_SHIFT;
      }
      if (data.control) {
        msg.wParam |= User.MK_CONTROL;
      }

      // Set position
      msg.lParam = (data.x & 0xffff) | ((data.y & 0xffff) << 16);

      messages.push(msg);
    } else if (event === 'focus') {
      //SetFocus.bind(this._win16)(hWnd);
    } else if (event === 'command') {
      // A menu was clicked or some other command event
      msg.message = User.WM_COMMAND;
      msg.wParam = data.id;
      msg.lParam = 0;
      messages.push(msg);
    } else if (event === 'timer') {
      // A menu was clicked or some other command event
      msg.message = User.WM_TIMER;
      msg.wParam = data.id;
      msg.lParam = new Date().getTime() - this._startTime;
      messages.push(msg);
    }

    // If we have a new message, post it to the queue.
    // If the task is running...
    // TODO: which messages are sent anyway?
    if (!this._halts[hWnd]) {
      messages.forEach((msg) => {
        msg.time = new Date().getTime() - this._startTime;
        task.push(msg);
        //this._scheduler.resume(taskHandle);
      });
    }
  }
}
