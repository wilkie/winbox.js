'use strict';

/**
 * How Windows encodes a selector, and what a global handle is.
 *
 * Two facts, both recorded from real Windows in `oracle/fixtures/handles.json`
 * rather than taken from a manual.
 *
 * The first is where descriptors live. Windows keeps a task's segments in the
 * **local** descriptor table, not the global one, so every selector it hands
 * out has the table indicator set. That is visible to the program: the bit is
 * part of the value it loads into a segment register, part of what
 * `AllocSelector` and `AllocDSToCSAlias` return, and part of anything that
 * compares two selectors for identity.
 *
 * The second is that a global handle is not an opaque number and not an index.
 * It is the same selector its memory is addressed through, with the requested
 * privilege level lowered by one:
 *
 *   handle    (index << 3) | LDT | RPL 2     ends in 6
 *   selector  (index << 3) | LDT | RPL 3     ends in 7
 *
 * so the two differ by exactly one, and shifting either right by three gives
 * the descriptor they share. That is what `GlobalHandle` exploits to turn a
 * pointer back into the handle it came from, and it is why a program can hold
 * a handle in the same word it later loads into a segment register.
 *
 * Everything that builds a selector should build it here. The encoding used to
 * be written out at fourteen call sites as `(index << 3) | 0x3`, which is how
 * it came to disagree with Windows without anyone deciding that it should.
 */

/** Descriptors live in the local table, which is what the table bit says. */
const TABLE = 0x4;

/** A handle names its descriptor at a privilege level code cannot run at. */
const HANDLE_RPL = 0x2;

/** Code, and everything addressing memory, runs at the lowest privilege. */
const SELECTOR_RPL = 0x3;

/**
 * The selector for a descriptor.
 *
 * This is what belongs in a segment register, and what a far pointer carries.
 *
 * @param {number} index - The index of the descriptor in the table.
 * @returns {number} The selector.
 */
export function segmentSelector(index) {
  return ((index << 3) | TABLE | SELECTOR_RPL) & 0xffff;
}

/**
 * The global handle that stands for a descriptor.
 *
 * @param {number} index - The index of the descriptor in the table.
 * @returns {number} The global handle.
 */
export function handleFor(index) {
  return ((index << 3) | TABLE | HANDLE_RPL) & 0xffff;
}

/**
 * The selector a handle's memory is addressed through.
 *
 * @param {number} handle - A global handle.
 * @returns {number} The selector, which is the handle at the lowest privilege.
 */
export function selectorFor(handle) {
  return segmentSelector(indexFor(handle));
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
