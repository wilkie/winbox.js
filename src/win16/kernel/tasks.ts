'use strict';

/**
 * The running task's handle: the one its windows belong to, as
 * `GetWindowTask` answers for them. **Recorded** by `minis`.
 *
 * @returns {Types.HANDLE} The task.
 */
export function GetCurrentTask() {
  return this.scheduler.active ?? 0;
}

/**
 * How many tasks are running, ended ones not counted. **Recorded** by
 * `minis`: one, the probe, which the recording runs as the shell.
 *
 * @returns {Types.UINT} The count.
 */
export function GetNumTasks() {
  const tasks = Object.values(this.scheduler._tasks ?? {}) as any[];

  return tasks.filter((task) => task && !task._ended).length;
}

/**
 * Whether a task is WinOldAp's, running a DOS program in a window: bit 0 of
 * the word at 48h of its module's database (`KRNL386.EXE` seg1 `7e3e`).
 * winbox.js runs no DOS program so, and every program's is clear: FALSE.
 * The Task List's End Task switches to a window first only where it is not
 * (`TASKMAN.EXE` seg1 `02fb`; `tasklist`).
 *
 * @returns {Types.BOOL} FALSE.
 */
export function IsWinOldApTask(this: any, _hTask: number) {
  return 0;
}

/**
 * Locks the running task, or none: KERNEL's word at 22Ch of its data,
 * which its scheduler holds every other task to (`KRNL286.EXE` seg1
 * `79d9`-`79f0`; `7912`-`791b`): while a task is locked, no other is
 * switched to, however it is woken, until it is let go. Answers the task
 * locked now, or nought. See `Scheduler.locked`.
 *
 * @param {Types.BOOL} fLock - Whether to lock the running task.
 * @returns {Types.HANDLE} The task locked, or nought.
 */
export function LockCurrentTask(this: any, fLock: number) {
  this.scheduler.locked = fLock ? (this.scheduler.active ?? 0) : 0;
  return this.scheduler.locked;
}

/**
 * The task `LockCurrentTask` locked, or nought (`KRNL286.EXE` seg1 `79f3`).
 * **Recorded** by `lockinp`.
 *
 * @returns {Types.HANDLE} The task.
 */
export function IsTaskLocked(this: any) {
  return this.scheduler.locked ?? 0;
}
