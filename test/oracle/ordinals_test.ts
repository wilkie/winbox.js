'use strict';

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Our ordinal numbering against the Windows SDK's.
 *
 * An ordinal is not ours to choose. A program imports USER.471, not
 * `lstrcmpi`, and the loader is expected to know which is which -- so a table
 * that puts something else at 471 sends every call to the wrong function, and
 * nothing about the resulting failure points at the numbering.
 *
 * This found 37 KERNEL exports sitting one slot late, all from a single
 * surplus placeholder in a run of them, along with two names mistyped badly
 * enough to matter: `'OpenJoba, 10'` had swallowed its own argument count into
 * the string, so the thunk would have unwound the wrong number of bytes off
 * the stack on return.
 *
 * The authority is the SDK's import library rather than the modules
 * themselves, which name only a fraction of what they export and leave the
 * rest to be imported by number alone.
 *
 * The check runs as the script rather than through imported helpers, because
 * that is the thing a person actually runs and there is no second
 * implementation to drift from it.
 */

const ROOT = join(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'oracle', 'dump-exports.mjs');
const LIBRARY = join(ROOT, 'oracle', '.cache', 'watcom', 'lib286', 'win', 'windows.lib');

// The library arrives with the toolchain, which is fetched rather than committed.
const whenFetched = existsSync(LIBRARY) ? it : it.skip;

describe('export ordinals', () => {
  whenFetched(
    'agree with the Windows SDK',
    async function () {
      const { stdout } = await run('node', [SCRIPT], { cwd: ROOT }).catch((error) => {
        // A non-zero exit means disagreements, and its output names them.
        throw new Error(`ordinals disagree with the SDK:\n${error.stdout ?? error.message}`);
      });

      expect(stdout).toMatch(/0 disagree/);
    },
    60000
  );
});
