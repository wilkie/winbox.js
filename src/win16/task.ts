'use strict';

/**
 * Encapsulates a loaded task on the system.
 */
export class Task {
  declare _callStack: any;
  declare _callback: any;
  declare _callbackStack: any;
  declare _contextStack: any;
  declare _curdir: any;
  declare _currentCall: any;
  declare _environmentSegment: any;
  declare _executable: any;
  declare _loader: any;
  declare _messageLock: any;
  declare _messages: any;
  declare _pendingStack: any;
  declare _programSegment: any;
  declare _ended: any;
  declare _stopped: any;
  declare _yield: any;
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

  get curdir() {
    return this._curdir;
  }

  set curdir(path) {
    this._curdir = path;
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

  /**
   * Whether the task has finished for good.
   *
   * `halt` is not this. A task is halted whenever it makes an API call that
   * has to wait for something, and is resumed when the answer arrives -- so a
   * program that halts itself is simply resumed a moment later. Ending is the
   * other thing: the program is done, and nothing should start it again.
   */
  get ended() {
    return this._ended === true;
  }

  /** Ends the task. It will not be resumed. */
  end() {
    this._ended = true;
    this.halt();
  }

  get programSegment() {
    return this._programSegment;
  }

  set programSegment(value) {
    this._programSegment = value;
  }

  get environmentSegment() {
    return this._environmentSegment;
  }

  set environmentSegment(value) {
    this._environmentSegment = value;
  }

  run() {
    if (this._ended) {
      return;
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
    return this._callStack.pop();
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
    if (this._messageLock) {
      const promise = this._messageLock;
      this._messageLock = null;

      // Call the message callback
      if (message.callback) {
        message.callback();
      }

      promise(message);
    } else {
      this._messages.push(message);
    }
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
  async pull() {
    if (this._messages.length == 0) {
      const promise = new Promise((resolve) => {
        this._messageLock = resolve;
      });

      return promise;
    }

    const ret = this._messages.splice(0, 1)[0];

    // Call the message callback
    if (ret && ret.callback) {
      ret.callback();
    }

    return ret;
  }
}
