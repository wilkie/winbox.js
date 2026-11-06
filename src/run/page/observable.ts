/**
 * A value that tells whoever listens when it is replaced: what the run page's
 * components read through React's `useSyncExternalStore` (`../ui/use.ts`),
 * and nothing more. `get` and `subscribe` are bound, as that hook takes them.
 */
export class Observable<T> {
  #value: T;
  readonly #listeners = new Set<() => void>();

  constructor(value: T) {
    this.#value = value;
  }

  /** The value as it stands: the same object until it is replaced. */
  readonly get = (): T => this.#value;

  /** A listener told of each value set, until the function returned is called. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** The value replaced, and every listener told. */
  set(value: T) {
    this.#value = value;

    for (const listener of [...this.#listeners]) {
      listener();
    }
  }
}
