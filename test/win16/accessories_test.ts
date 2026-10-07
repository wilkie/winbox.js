'use strict';

import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IMAGE, runProbe } from './run-probe.js';

/**
 * Windows 3.1's own programs, from the installation, used as a person at the
 * page uses them, and held to what shows and what they wrote. The Rust
 * engine's `crates/winbox-web/tests/accessories.rs` does the same and more.
 * Each program runs from `C:\CORPUS\SWEEP`, where what it saves goes.
 */

const WINDOWS = join(__dirname, '..', '..', 'oracle', 'build', 'drive-c', 'WINDOWS');

/** A step: keys and clicks, `;` between them, then the seconds run on. */
const step = (keys: string, seconds = 1, then?: (win16: any) => void) => ({
  keys: keys.split(';'),
  seconds,
  then,
});

/** A program of the installation run, the steps taken: its trees after each, and a file it wrote. */
async function session(
  program: string,
  steps: { keys: string[]; seconds: number; then?: (win16: any) => void }[],
  read?: string
) {
  const copied = mkdtempSync(join(tmpdir(), 'winbox-accessories-'));

  try {
    copyFileSync(join(WINDOWS, program), join(copied, program));

    const ran: any = await runProbe('accessories', 0, false, true, 3, {
      program: { directory: copied, file: program, folder: 'SWEEP' },
      virtual: true,
      keepCalls: 0,
      steps,
      trees: true,
    });
    let file: Buffer | null = null;

    if (read) {
      const opened = await ran.fileSystem.open(['CORPUS', 'SWEEP', read]);

      file = opened ? Buffer.from(await opened.read(0, opened.info.size)) : null;
    }

    return { trees: ran.trees.slice(1), file };
  } finally {
    rmSync(copied, { recursive: true, force: true });
  }
}

/** Every node of a tree, depth first. */
function nodes(tree: any) {
  const all: any[] = [];
  const walk = (node: any) => {
    all.push(node);
    node.children?.forEach(walk);
  };

  tree.nodes.forEach(walk);
  return all;
}

(existsSync(IMAGE) && existsSync(join(WINDOWS, 'NOTEPAD.EXE')) ? describe : describe.skip)(
  "Windows' accessories, used",
  () => {
    /* Control Panel's window, made empty, set its scroll bar at each
     * `WM_SIZE` from a width that depends on the bar, and the bar's frame
     * change sent another `WM_SIZE` though the client area had not changed:
     * it went on until its stack ran out (`USER.EXE` seg7 `0fe6`, `122d`). */
    it('shows Control Panel and its applets', async () => {
      const { trees } = await session('CONTROL.EXE', [step('Shift_L')]);
      const names = nodes(trees[0]).map((node) => node.name);

      expect(names).toContain('Control Panel');
      expect(names).toContain('Changes the Windows screen colors');
    }, 300000);
  }
);
