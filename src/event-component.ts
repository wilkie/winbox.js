'use strict';

/**
 * Extending this class allows a component to provide event handling and
 * callbacks.
 */
export class EventComponent {
  declare _events: any;
  constructor() {
    this._events = {};
  }

  /**
   * A generic event callback.
   *
   * @callback eventCallback
   * @param {data} - Any event data.
   */

  /**
   * Sets a callback for the given event.
   *
   * @param {string} name - The name of the event.
   * @param {eventCallback} callback - The callback function.
   */
  on(name, callback) {
    if (callback === undefined) {
      return this._events[name];
    }
    if (!this._events[name]) {
      this._events[name] = [];
    }
    this._events[name].push(callback);
    return this;
  }

  /**
   * Removes a callback for the given event.
   *
   * @param {string} name - The name of the event.
   * @param {eventCallback} callback - The callback function.
   */
  off(name, callback) {
    if (!this._events[name]) {
      return;
    }
    const index = this._events[name].indexOf(callback);
    if (index >= 0) {
      this._events[name].splice(index, 1);
    }
    return this;
  }

  /**
   * Triggers an event of the given event type.
   *
   * @param {string} name - The name of the event.
   * @param {any} data - The data to send along with the event.
   */
  trigger(name, data?) {
    if (this._events[name]) {
      this._events[name].filter((element) => {
        return element;
      });
      this._events[name].forEach((cb) => {
        cb.call(this, data);
      });
    }

    return this;
  }

  /**
   * Returns the @eventCallback of the given event name if it has been
   * registered.
   *
   * @param {string} name - The name of the event.
   *
   * @returns {eventCallback}
   */
  callbacksFor(name) {
    return this._events[name];
  }
}

export default EventComponent;
