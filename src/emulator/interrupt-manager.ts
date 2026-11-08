/**
 * Manages interrupt dispatch.
 *
 * Interrupts are not immediately dispatched so the emulator can decide to
 * delay them.
 */
export class InterruptManager {
  declare _interrupts: any;

  /**
   * Where a program's own handler for a vector is called before the
   * machine's: the DPMI host's, for the handlers a program sets (INT 31h
   * 0203h and 0205h). It answers true where it took the interrupt, and
   * claims the vectors it would.
   */
  intercept: ((index: number) => boolean | undefined) | null = null;
  claims: ((index: number) => boolean) | null = null;

  constructor() {
    this._interrupts = {};
  }

  on(index, callback) {
    this._interrupts[index] = callback;
  }

  /**
   * Whether a callback is registered for the given interrupt.
   */
  has(index) {
    return this._interrupts[index] !== undefined || !!this.claims?.(index);
  }

  off(index) {
    delete this._interrupts[index];
  }

  dispatch(index, data = null) {
    const taken = this.intercept?.(index);

    if (taken !== undefined) {
      return taken;
    }

    if (this._interrupts[index]) {
      return this._interrupts[index](data);
    }

    return null;
  }
}
