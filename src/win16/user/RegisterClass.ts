'use strict';

import { TRUE } from '../consts.js';

import { User } from '../user.js';

import { LoadMenu } from './LoadMenu.js';

/**
 * The **RegisterClass** function registers a window class for subsequent use
 * in calls to the {@link User.CreateWindow CreateWindow} or
 * {@link User.CreateWindowEx CreateWindowEx} function.
 *
 * An application cannot register a global class if either a global class or a
 * task-specific class already exists with the given name.
 *
 * An application can register a task-specific class with the same name as a
 * global class. The task-specific class overrides the global class for the
 * current task only. A task cannot register two local classes with the same
 * name. However, two different tasks can register task-specific classes using
 * the same name.
 *
 * **See also**:
 * {@link User.PeekMessage PeekMessage}
 * {@link User.GetMessage GetMessage}
 * {@link User.TranslateAccelerator TranslateAccelerator}
 *
 * @static
 * @function RegisterClass
 * @memberof User
 *
 * @param {Types.WNDCLASS} lpwc - Points to a WNDCLASS structure. The structure
 *                                must be filled with the appropriate class
 *                                attributes before being passed to the
 *                                function.
 *
 * @return {Types.ATOM} The return value is an atom that uniquely identifies
 *                      the class being registered. For system versions 3.0 and
 *                      earlier, the return value is nonzero if the function is
 *                      successful or zero if an error occurs.
 */
export async function RegisterClass(lpwc) {
  // Get the menu, if provided
  let menuHandle = null;
  if (lpwc.lpszMenuName) {
    console.log('LOADING MENU BY NAME');
    menuHandle = await LoadMenu.bind(this)(lpwc.hInstance, lpwc.lpszMenuName);
  }

  // Create an ATOM for the class
  lpwc._menuHandle = menuHandle;
  const handle = this.handles.allocate(lpwc);
  if (handle) {
    // Register a name for the ATOM
    this.handles.register(handle, lpwc.lpszClassName);
  }

  console.log('returning', handle);

  // Return the ATOM handle
  return handle;
}
