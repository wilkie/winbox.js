/**
 * Manages interrupt dispatch.
 *
 * Interrupts are not immediately dispatched so the emulator can decide to
 * delay them.
 */
export class InterruptManager {
  declare _interrupts: any;
  constructor() {
    this._interrupts = {};
  }

  on(index, callback) {
    this._interrupts[index] = callback;
  }

  off(index) {
    delete this._interrupts[index];
  }

  dispatch(index, data = null) {
    if (this._interrupts[index]) {
      return this._interrupts[index](data);
    }

    return null;
  }
}
