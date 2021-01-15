"use strict";

import { NULL } from '../consts.js';

import { Executable } from '../../executable.js';

import { FixedWindow } from '../../windows/fixed-window.js';
import { SubMenu, Menu } from '../../controls/menu.js';

/**
 * The **LoadMenu** function loads the specified menu resource from the
 * executable file associated with the given application instance.
 *
 * Before exiting, an application must free system resources associated with a
 * menu if the menu is not assigned to a window. An application frees a menu by
 * calling the {@link User.DestroyMenu DestroyMenu} function.
 *
 * @static
 * @function LoadMenu
 * @memberof User
 *
 * @param {Types.HINSTANCE} hinst - Identifies an instance of the module whose
 *                                  executable file contains the menu to be
 *                                  loaded.
 * @param {Types.LPCSTR} lpszMenuName - Points to a null-terminated string that
 *                                      contains the name of the menu resource
 *                                      to be loaded. Alternatively, this
 *                                      parameter can consist of the resource
 *                                      identifier in the low-order word and
 *                                      zero in the high-order word.
 *
 * @return {Types.HMENU} The return value is the handle of the menu resource if
 *                       the function is successful. Otherwise, it is `NULL`.
 */
export async function LoadMenu(hinst, lpszMenuName) {
    // Resolve the handle
    let module = this.handles.resolve(hinst);

    // Fail out if the handle is not found
    if (!module) {
        return NULL;
    }

    let id = lpszMenuName;
    if (id instanceof String || (typeof id) == 'string') {
        id = id.toUpperCase();
    }

    let cpu = this.machine.cpu.core;

    let executable = module.executable;

    let ret = NULL;

    // Find the menu resource
    let resourceInfo = null;
    for (let i = 0; i < executable.resources.length; i++) {
        let resourceType = executable.resources[i];
        if (resourceType.id == Executable.RESOURCES.Menu) {
            for (let j = 0; j < resourceType.entries.length; j++) {
                let resource = resourceType.entries[j];
                if (resource.id == id) {
                    resourceInfo = resource;
                    break;
                }
            }
        }
    }

    // Parse the menu resource
    if (resourceInfo) {
        let data = new Uint8Array(await executable.readResource(resourceInfo));
        console.log("found menu", data);
        let view = new DataView(data.buffer);

        // Read version
        // Should be version 0 most of the time for Win16.
        let version = view.getUint16(0, true);

        // Read the offset to the menu data (likely 0 as well)
        let offset = view.getUint16(2, true);

        let position = 4 + offset;

        // Read each entry
        let menuStack = [];
        let ended = [];
        let menu = new Menu();
        menuStack.push(menu);
        ended.push(false);

        ret = this.handles.allocate(menu);

        while (position + 3 < resourceInfo.length) {
            // Read flags
            let flags = view.getUint16(position, true);
            position += 2;

            // Read id, if needed
            let id = 0;
            if (!(flags & 0x10)) {
                // Menu Item
                id = view.getUint16(position, true);
                position += 2;
            }
            else {
                // Submenu
            }

            // Read text
            let title = "";
            for ( ; position < resourceInfo.length; position++) {
                let b = view.getUint8(position);
                if (b == 0) {
                    break;
                }
                title += String.fromCharCode(b);
            }
            position++;

            title = title || "-";

            let menu = new Menu({ caption: title });
            menu.data = {id: id}

            if (flags & 0x1) {
                menu.disabled = true;
            }

            menu.on("click", (e) => {
                console.log("WHY IS THE ID", id, menu.caption);
                let dialog = menu.parent;
                while (dialog.parent && !(dialog instanceof FixedWindow)) {
                    dialog = dialog.parent;
                }

                if (dialog && dialog.data.hWnd && id) {
                    // We need to send the WM_COMMAND message with the id
                    let task = this.handles.resolve(dialog.data.hInstance);
                    this.windows.createMessage(dialog.data.hInstance, task, dialog.data.hWnd, 'command', {id: menu.data.id}); 
                    console.log("menu clicked", dialog.data.hInstance, dialog.data.hWnd, menu.data.id);
                }
            });

            console.log("menu item", flags, id, title, "appending to", menuStack[menuStack.length - 1].caption);

            // Append to the current window
            menuStack[menuStack.length - 1].append(menu);

            if (flags & 0x80) {
                ended[menuStack.length - 1] = true;
            }

            if (flags & 0x10) {
                // Submenu... we want to push to the stack
                menuStack.push(menu);
                ended.push(false);
            }
            else {
                // React to whether or not the last item was ended
                while (ended[menuStack.length - 1]) {
                    console.log("---");
                    menuStack.pop();
                    ended.pop();
                }
            }
        }
    }

    // If we could not find the string, ret remains 0.
    return ret;
}
