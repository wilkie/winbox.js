"use strict";

/**
 * Encapsulates a loaded task on the system.
 */
export class Task {
    constructor(executable, loader) {
        this._executable = executable;
        this._loader = loader;
        this._stopped = false;
        this._messages = [];
        this._context = null;
    }

    get context() {
        return this._context;
    }

    set context(value) {
        this._context = value;
    }

    set returnValue(procedure) {
        this._returnValue = procedure;
    }

    get executable() {
        return this._executable;
    }

    get loader() {
        return this._loader;
    }

    get stopped() {
        return this._stopped;
    }

    get programSegment() {
        return this._programSegment;
    }

    set programSegment(value) {
        this._programSegment = value;
    }

    run() {
        if (this._returnValue) {
            // Call the return value procedure
            this._returnValue();
            this._returnValue = null;
        }

        this._stopped = false;
    }

    halt() {
        this._stopped = true;
    }

    /**
     * Pushes a window message to the message queue.
     */
    push(message) {
        this._messages.push(message);
    }

    /**
     * Returns the next message in the queue or null if empty.
     */
    peek() {
        if (this._messages.length == 0) {
            return null;
        }

        return this._messages[0];
    }

    /**
     * Pulls the oldest message from the queue or returns null if empty.
     */
    pull() {
        if (this._messages.length == 0) {
            return null;
        }

        let ret = this._messages.splice(0, 1)[0];
        return ret;
    }
}
