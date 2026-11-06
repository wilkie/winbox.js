'use strict';

import { globalBlocks } from '../toolhelp/global.js';
import { moduleChain } from '../toolhelp/modules.js';
import { moduleOfTask } from '../toolhelp/tasks.js';
import { liveTask, taskInstance, taskList } from './task-order.js';
import { GlobalHandle } from './GlobalHandle.js';
import { indexFor } from '../selectors.js';

/**
 * The module a handle is of (`KRNL386.EXE` seg1 `4e78`-`4eff`): a module's
 * own handle, odd with `NE` at its start; a task's instance, the task's
 * module; else the owner of the block the handle or selector is of, where
 * that is a module, or where it is a task's prefix the task's module.
 * Nought for anything else. **Recorded** by `ktask`: the module for the
 * probe's instance, its module, a block of its own and its code segment;
 * USER's for USER's; nought for 1234h. winbox.js's task is its instance,
 * so its handle finds its module too, where Windows' finds nought.
 */
export function GetExePtr(this: any, hInstance: number) {
  const handle = hInstance & 0xffff;

  if (!handle) {
    return 0;
  }

  const chain = moduleChain(this);

  if (handle & 1 && chain.some((module) => module.handle === handle)) {
    return handle;
  }

  for (const each of taskList(this)) {
    const task = liveTask(this, each);

    if (task && taskInstance(task) === handle) {
      return moduleOfTask(this, task);
    }
  }

  const block = globalBlocks(this).find((each) => each.index && each.index === indexFor(handle));

  if (!block) {
    return 0;
  }

  if (chain.some((module) => module.handle === block.owner)) {
    return block.owner;
  }

  const task = liveTask(this, block.owner);

  return task ? moduleOfTask(this, task) : 0;
}

/**
 * Whether a selector is a library's: the module `GetExePtr` finds for it
 * has bit 15 of its flags (NE 0Ch) set (`KRNL386.EXE` seg1 `4d39`-`4d59`).
 * **Recorded** by `ktask`: nought for the probe's data and a block of its
 * own, 1 for USER's instance.
 */
export function IsSharedSelector(this: any, hSelector: number) {
  const module = GetExePtr.call(this, hSelector);

  if (!module) {
    return 0;
  }

  const item = this.handles.resolveModule(module);
  const loader = item?.loader ?? (item?.executable ? item : null);

  if (loader?.executable?.neHeader) {
    return loader.executable.neHeader.flags & 0x8000 ? 1 : 0;
  }

  /* One of winbox.js's own: KERNEL, USER and GDI and the rest are libraries. */
  return 1;
}

/** `GlobalHandle` with no debugging message for a bad selector (seg1 `0ec5`): the same answer. */
export function GlobalHandleNoRIP(this: any, uGlobalSel: number) {
  return GlobalHandle.call(this, uGlobalSel);
}
