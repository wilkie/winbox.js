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
