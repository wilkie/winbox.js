"use strict";

/**
 * Encapsulates a loaded task on the system.
 */
export class Task {
    constructor(executable, loader) {
        this._executable = executable;
        this._loader = loader;
        this._stopped = false;
        this._yield = false;
        this._messages = [];
        this._contextStack = [];
        this._callbackStack = [];
        this._callStack = [];
        this._pendingStack = [];
    }

    set returnValue(procedure) {
        this._returnValue = procedure;
    }

    get currentCall() {
        return this._currentCall;
    }

    set currentCall(callItem) {
        this._currentCall = callItem;
    }

    get callback() {
        return this._callback;
    }

    set callback(value) {
        this._callback = value;
    }

    get executable() {
        return this._executable;
    }

    get loader() {
        return this._loader;
    }

    set yield(value) {
        this._yield = value;
    }

    get yield() {
        return this._yield;
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
        this._yield = true;
    }

    /**
     * Prepends an asynchronous callback to the call stack.
     */
    unpullCall(callItem) {
        this._callStack.unshift(callItem);

        // Make sure we don't execute the current path
        this._yield = true;
    }

    /**
     * Pushes an asynchronous callback to the call stack.
     */
    pushCall(callItem) {
        this._callStack.push(callItem);

        // Make sure we don't execute the current path
        this._yield = true;
    }
    
    pullCall() {
        return this._callStack.shift();
    }

    pollCall() {
        return this._callStack[0];
    }

    pushPending(callItem) {
        this._pendingStack.push(callItem);
    }

    popPending() {
        return this._pendingStack.pop();
    }

    pollPending() {
        return this._pendingStack[this._pendingStack.length - 1];
    }

    pushContext(context) {
        this._contextStack.push(context);
    }

    popContext() {
        return this._contextStack.splice(this._contextStack.length - 1, 1)[0];
    }

    pushCallback(callback) {
        this._callbackStack.push(callback);
    }

    popCallback() {
        return this._callbackStack.splice(this._callbackStack.length - 1, 1)[0];
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
