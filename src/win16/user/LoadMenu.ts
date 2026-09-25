'use strict';

import { NULL } from '../consts.js';

import { Executable } from '../../executable.js';

import { MenuData } from './menu-data.js';

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
  const module = this.handles.resolve(hinst);

  // Fail out if the handle is not found
  if (!module) {
    return NULL;
  }

  let id = 0xffff;
  let name = null;
  if (lpszMenuName instanceof String || typeof lpszMenuName == 'string') {
    name = lpszMenuName.toUpperCase();
  } else {
    id = lpszMenuName;
  }

  const executable = module.executable;

  // Find the menu resource
  let resourceInfo = null;
  for (let i = 0; i < executable.resources.length; i++) {
    const resourceType = executable.resources[i];
    if (resourceType.id == Executable.RESOURCES.Menu) {
      for (let j = 0; j < resourceType.entries.length; j++) {
        const resource = resourceType.entries[j];
        /* A named resource's name may be kept as its `id`. */
        if (
          resource.id == id ||
          (name !== null && (resource.name === name || String(resource.id).toUpperCase() === name))
        ) {
          resourceInfo = resource;
          break;
        }
      }
    }
  }

  if (!resourceInfo) {
    return NULL;
  }

  const data = new Uint8Array(await executable.readResource(resourceInfo));

  return this.handles.allocate(parseMenu(data, resourceInfo.length));
}

const MF_POPUP = 0x0010;
const MF_END = 0x0080;

/**
 * A menu resource as a menu: a header of two words, the version and the
 * offset to the items, then each item's flags, its identifier unless it opens
 * a pop-up, and its text. A pop-up's items follow it, and the last item of
 * any menu has `MF_END`.
 */
export function parseMenu(data: Uint8Array, length = data.length) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const root = new MenuData();
  const stack: MenuData[] = [root];
  let position = 4 + view.getUint16(2, true);

  while (position + 3 < length && stack.length) {
    const flags = view.getUint16(position, true);
    position += 2;

    let id = 0;

    if (!(flags & MF_POPUP)) {
      id = view.getUint16(position, true);
      position += 2;
    }

    let text = '';

    for (; position < length && data[position] !== 0; position++) {
      text += String.fromCharCode(data[position]);
    }

    position++;

    const menu = stack[stack.length - 1];
    const popup = flags & MF_POPUP ? new MenuData() : undefined;

    menu.items.push({ flags: flags & ~MF_END, id, text, popup });

    if (flags & MF_END) {
      stack.pop();
    }

    if (popup) {
      stack.push(popup);
    }
  }

  return root;
}
