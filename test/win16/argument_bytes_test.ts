'use strict';

import { Gdi } from '../../src/win16/gdi.js';
import { Kernel } from '../../src/win16/kernel.js';
import { User } from '../../src/win16/user.js';
import { Types, VARIADIC } from '../../src/win16/types.js';

/**
 * Every export says how many bytes of arguments it takes -- twice.
 *
 * A Win16 function is called with the Pascal convention, so the *callee*
 * removes the arguments: the thunk we build for each export ends in `RETF n`,
 * and `n` comes from the third field of its table entry. The fourth field is
 * the argument list, which is what the arguments are actually read from. The
 * two are the same fact written down in two places, and nothing until now made
 * them agree.
 *
 * When they disagree the caller's stack pointer is wrong from the return
 * onward, and nothing about the failure points at the function that caused it.
 * `lstrcat` declared four bytes and took eight, so every call left four bytes
 * of rubbish on the stack; Clock called it three times while building the
 * string in its title bar, and then read its own window handle back off the
 * stack twelve bytes adrift and asked `GetMenu` about a window that did not
 * exist. The failure surfaced two functions and several hundred instructions
 * after the mistake.
 *
 * The argument list is the authority here, because it is the thing that has to
 * describe the arguments correctly for them to be read at all.
 */

/** The variadic marker is not an argument and has no size. */
function sizeOfArguments(argumentList) {
  let total = 0;

  for (const argument of argumentList) {
    if (argument === VARIADIC) {
      return null;
    }

    /* What the argument occupies on the stack, which is not always its size:
     * anything narrower than a word still takes a whole word when pushed, and
     * the marshaller advances by two for it.
     */
    const size = Types.sizeof(argument);

    total += size <= 2 ? 2 : size;
  }

  return total;
}

describe.each([
  ['KERNEL', Kernel],
  ['USER', User],
  ['GDI', Gdi],
])('%s exports', (name, module: any) => {
  it('pop as many bytes as their arguments occupy', function () {
    const wrong: string[] = [];

    let checked = 0;

    module.exports.forEach((tuple, ordinal) => {
      if (!tuple || !tuple[3]) {
        return;
      }

      const declared = tuple[2] || 0;
      const actual = sizeOfArguments(tuple[3]);

      /* `wsprintf` and its kin are the exception, and it is a real one: they
       * are the only C-convention functions in the API, so the caller removes
       * the arguments and the thunk must pop nothing at all.
       */
      if (actual === null) {
        checked++;

        if (declared !== 0) {
          wrong.push(`${name}.${tuple[1]} (${ordinal}) is variadic but pops ${declared}`);
        }

        return;
      }

      checked++;

      if (declared !== actual) {
        wrong.push(`${name}.${tuple[1]} (${ordinal}) pops ${declared}, arguments take ${actual}`);
      }
    });

    // Worth knowing the check reached something, rather than passing empty.
    expect(checked).toBeGreaterThan(20);
    expect(wrong).toEqual([]);
  });
});
