'use strict';

/**
 * The relationship between a global handle and a selector.
 *
 * A global handle is not an opaque number and it is not an index. It is a
 * selector -- the same selector its memory is addressed through -- with the
 * requested privilege level lowered by one. Locking a block raises it back:
 *
 *   handle    (index << 3) | RPL 2
 *   selector  (index << 3) | RPL 3
 *
 * so the two differ by exactly one, and shifting either right by three gives
 * the descriptor they share. That is what `GlobalHandle` exploits to turn a
 * pointer back into the handle it came from, and it is why software can hold a
 * handle in the same word it later loads into a segment register.
 *
 * Measured rather than assumed: `oracle/fixtures/handles.json` records real
 * Windows returning `difference=1` with low bits of 6 and 7 for fixed,
 * moveable and discardable blocks alike.
 *
 * The one place we knowingly differ is the table. Windows puts these
 * descriptors in the LDT, so its low three bits are 6 and 7; ours are in the
 * GDT, so they are 2 and 3. The privilege relationship -- the part that decides
 * whether a handle and a pointer can be told apart, and whether either can be
 * loaded into a segment register -- is the same either way.
 */

/** The table and privilege bits of a handle: this descriptor, at RPL 2. */
const HANDLE_BITS = 0x2;

/** The same descriptor at RPL 3, which is what code addresses memory through. */
const SELECTOR_BITS = 0x3;

/**
 * The handle that stands for a descriptor.
 *
 * @param {number} index - The index of the descriptor in the table.
 * @returns {number} The global handle.
 */
export function handleFor(index) {
  return ((index << 3) | HANDLE_BITS) & 0xffff;
}

/**
 * The selector a handle's memory is addressed through.
 *
 * @param {number} handle - A global handle.
 * @returns {number} The selector, which is the handle at RPL 3.
 */
export function selectorFor(handle) {
  return ((handle & ~0x7) | SELECTOR_BITS) & 0xffff;
}

/**
 * The descriptor a handle or a selector refers to.
 *
 * Both forms answer the same, which is the point of them differing only in
 * bits the descriptor lookup ignores.
 *
 * @param {number} handleOrSelector - Either form.
 * @returns {number} The index of the descriptor.
 */
export function indexFor(handleOrSelector) {
  return handleOrSelector >> 3;
}
