"use strict";

/**
 * Represents the system scheduler.
 */
export class Scheduler {
    constructor(machine) {
        this._tasks = {};
        this._machine = machine;

        this._currentTask = null;
    }

    /**
     * Returns the current task handle.
     *
     * @return {HINSTANCE} The current task handle.
     */
    get active() {
        return this._currentTask;
    }

    /**
     * Returns the current active task.
     *
     * @return {Task} The current active task.
     */
    get task() {
        return this._tasks[this._currentTask];
    }

    /**
     * Registers the task by its handle.
     */
    register(handle, task) {
        this._tasks[handle] = task;
    }

    /**
     * Places the given task in the scheduler queue by its handle.
     */
    queue(handle) {
        this._currentTask = handle;
    }

    run() {
        function step(elapsed) {
            try {
                let currentHandle = this.active;
                let currentTask = this._tasks[currentHandle];
                if (currentTask) {
                    for (let i = 0; i < 1000; i++) {
                        if (currentTask.stopped) {
                            break;
                        }
                        this._machine.cpu.step();
                    }

                    if (!currentTask.stopped) {
                        window.requestAnimationFrame(step.bind(this));
                    }
                }
            }
            catch (e) {
                console.log("error", e);
                return;
            }
        }

        window.requestAnimationFrame(step.bind(this));
    }
}
