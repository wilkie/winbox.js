"use strict";

import { User, MSG } from './user.js';

import { GetTickCount } from './user/GetTickCount.js';

export class WindowManager {
    constructor(scheduler) {
        this._scheduler = scheduler;
    }

    register(taskHandle, task, hWnd, windowInstance) {
        // Capture events
        ['client-mousedown'].forEach( (event) => {
            windowInstance.on(event, (data) => {
                this.createMessage(taskHandle, task, hWnd, event, data);
            });
        });
    }

    /**
     * Crafts a message for the given event and pushes it to the given task.
     */
    createMessage(taskHandle, task, hWnd, event, data) {
        let msg = new MSG();
        msg.hwnd = hWnd;

        if (event === 'client-mousedown' ||
            event === 'client-mouseup') {

            // Get the proper message
            if (event === 'client-mousedown') {
                if (data.clicks == 2) {
                    msg.message = [
                        User.WM_LBUTTONDBLCLK,
                        User.WM_MBUTTONDBLCLK,
                        User.WM_RBUTTONDBLCLK
                    ][data.button];
                }
                else {
                    msg.message = [
                        User.WM_LBUTTONDOWN,
                        User.WM_MBUTTONDOWN,
                        User.WM_RBUTTONDOWN
                    ][data.button];
                }
            }
            else {
                msg.message = [
                    User.WM_LBUTTONUP,
                    User.WM_MBUTTONUP,
                    User.WM_RBUTTONUP
                ][data.button];
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
            msg.lParam = (data.x & 0xffff) | ((data.y & 0xffff) << 16)
        }

        // If we have a new message, post it
        if (msg.message != 0) {
            msg.time = GetTickCount.bind(this)();
            task.push(msg);
            this._scheduler.queue(taskHandle);
            task.run();
            this._scheduler.run();
        }
    }
}
