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
  declare queueChanges: number;
  /** Those waiting for the next message, whatever it is: a filtered `GetMessage`. */
  declare _arrivals: (() => void)[];
  declare _input: any;

  /** The exit code `PostQuitMessage` left, until `WM_QUIT` is taken; see `postQuit`. */
  declare quitCode: number | null | undefined;
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
    this._arrivals = [];
    this._input = [];
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
   * Pushes a window message to the message queue: a posted one, or with
   * `input`, one of the mouse's or the keyboard's.
   *
   * The two are kept apart because Windows gives a program what was posted
   * to it before its input: the `WM_CHAR` `TranslateMessage` posts for a key
   * comes before the key's release, which was already waiting when it was
   * posted. Taken in one line, the release of Alt after Alt and a letter
   * reached `DefWindowProc` before the letter did, and opened the menu bar
   * rather than the letter's menu.
   */
  push(message, input = false) {
    /* The kinds of message that arrived since `GetQueueStatus` or a message
     * taken last asked: its low word (`userwin`). */
    this.queueChanges = (this.queueChanges ?? 0) | queueKind(message.message, input);

    if (this._messageLock) {
      const promise = this._messageLock;
      this._messageLock = null;

      // Call the message callback
      if (message.callback) {
        message.callback();
      }

      promise(message);
    } else if (input) {
      this._input.push(message);
      this.signal();
    } else {
      this._messages.push(message);
      this.signal();
    }
  }

  /** Waits for the next message to arrive, or for something to be due to paint. */
  arrival(): Promise<void> {
    return new Promise((resolve) => this._arrivals.push(resolve));
  }

  /**
   * What wakes the task where it waits with the processor given up: it is
   * put in line for the processor at once, so the tasks woken go in the
   * order they were woken (see `Scheduler.waitForWake`).
   */
  declare onWake: (() => void) | null | undefined;

  /** Wakes those waiting for an arrival. */
  signal() {
    const waiting = this._arrivals;

    this._arrivals = [];
    waiting.forEach((resolve) => resolve());

    const wake = this.onWake;

    if (wake) {
      this.onWake = null;
      wake();
    }
  }

  /**
   * Returns the next message in the queue or null if empty.
   */
  peek() {
    return this._messages[0] ?? this._input[0] ?? null;
  }

  /**
   * The oldest message that matches, posted before input, taken from the
   * queue if asked: `PeekMessage` with a filter. Null for none.
   */
  find(match: (message: any) => boolean, remove: boolean) {
    for (const queue of [this._messages, this._input]) {
      const at = queue.findIndex(match);

      if (at >= 0) {
        const found = remove ? queue.splice(at, 1)[0] : queue[at];

        if (remove && found?.callback) {
          found.callback();
        }

        return found;
      }
    }

    return null;
  }

  /**
   * Pulls the oldest message from the queue or returns null if empty: the
   * oldest posted one, or the oldest input.
   */
  async pull() {
    if (this._messages.length == 0 && this._input.length == 0) {
      const promise = new Promise((resolve) => {
        this._messageLock = resolve;
      });

      return promise;
    }

    const ret = (this._messages.length ? this._messages : this._input).splice(0, 1)[0];

    // Call the message callback
    if (ret && ret.callback) {
      ret.callback();
    }

    return ret;
  }
}

/**
 * The `QS_` kind a message is, for `GetQueueStatus`: a key's 1, a mouse
 * move's 2, a button's 4, one posted 8.
 */
export function queueKind(message: number, input: boolean) {
  if (!input) {
    return 0x08;
  }

  if (message >= 0x100 && message <= 0x108) {
    return 0x01;
  }

  return message === 0x200 || message === 0xa0 ? 0x02 : 0x04;
}
