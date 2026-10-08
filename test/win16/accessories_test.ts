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

/** Letters, digits and Return typed, as keysyms. */
const typed = (text: string) => [...text].map((c) => (c === '\n' ? 'Return' : c)).join(';');

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

/** The values of the text boxes in the window named. */
function fields(tree: any, window: string) {
  const top = tree.nodes.find((node: any) => node.name === window);

  return top
    ? nodes({ nodes: [top] })
        .filter((n) => n.role === 'textbox')
        .map((n) => n.value)
    : null;
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

    /* File Manager's tree finds the directory it opened in by its item's data
     * (`USER.EXE` seg35 `1f1f`); finding none, its window was named `\*.*`. */
    it("selects File Manager's directory in its tree", async () => {
      const { trees } = await session('WINFILE.EXE', [step('Shift_L')]);

      expect(nodes(trees[0]).map((node) => node.name)).toContain('C:\\CORPUS\\SWEEP\\*.*');
    }, 300000);

    /* File Manager's message filter answers in AX, DX left as it was; read as
     * a long, every key in its Copy box was taken as filtered (seg1 `80f0`). */
    it("types into File Manager's Copy box", async () => {
      const { trees } = await session('WINFILE.EXE', [step('F8', 2), step(typed('ab'), 2)]);

      expect(fields(trees[1], 'Copy')).toContain('ab');
    }, 300000);

    /* A letter typed with Control was the letter, not a control character
     * (`KEYBOARD.DRV` seg10 `05b2`): Calculator's Control and C copied
     * nothing. */
    it('copies and pastes a sum in Calculator with the Control keys', async () => {
      const { trees } = await session('CALC.EXE', [
        step(typed('42')),
        step('Control_L+c;Escape'),
        step('Control_L+v'),
      ]);
      const display = (tree: any) =>
        nodes(tree).find((node) => node.role === 'text' && /^ \d+\.$/.test(node.name ?? ''))?.name;

      expect(display(trees[0])).toBe(' 42.');
      expect(display(trees[1])).toBe(' 0.');
      expect(display(trees[2])).toBe(' 42.');
    }, 300000);

    /* Notepad saves from the block its edit control handed it, which held
     * noughts: the text is kept there as it changes (seg26 `05c4`). */
    it('saves what was typed in Notepad', async () => {
      const { file } = await session(
        'NOTEPAD.EXE',
        [step(typed('hello')), step('Alt_L+f'), step('a', 2), step(typed('typed\n'), 2)],
        'TYPED.TXT'
      );

      expect(file?.toString('latin1')).toBe('hello');
    }, 300000);

    /* Control or Shift with Insert or Delete copy, paste and cut in an edit
     * control (seg28 `0a93`). */
    it("copies, cuts and pastes with an edit control's keys", async () => {
      const { trees } = await session('NOTEPAD.EXE', [
        step(typed('abc')),
        step('Shift_L+Home;Control_L+Insert;End;Shift_L+Insert'),
        step('Shift_L+Home;Shift_L+Delete'),
        step('Shift_L+Insert;Shift_L+Insert'),
      ]);

      expect(fields(trees[1], 'Notepad - (Untitled)')).toEqual(['abcabc']);
      expect(fields(trees[2], 'Notepad - (Untitled)')).toEqual(['']);
      expect(fields(trees[3], 'Notepad - (Untitled)')).toEqual(['abcabcabcabc']);
    }, 300000);

    /* Write's Save As kept the focus in the document: the box made active with
     * the focus left elsewhere did not take it (seg1 `37a3`). */
    it('saves a Write document through its Save As box', async () => {
      const { file } = await session(
        'WRITE.EXE',
        [step(typed('Hello')), step('Alt_L+f'), step('a', 2), step(typed('doc\n'), 2)],
        'DOC.WRI'
      );

      expect(file?.subarray(0, 2)).toEqual(Buffer.from([0x31, 0xbe]));
      expect(file?.includes('Hello')).toBe(true);
    }, 300000);

    /* Notepad's Find box has its focus back in its field after the "Cannot
     * find" box over it, its text as it was: the box, made hidden, is made
     * active as its button is given the focus, so the Find box is told while
     * its focus is still in its field, and has it back as the box goes, by
     * `SetFocus` alone (seg1 `3899`, `3514`, seg25 `03e3`; `hidfocus`). Given
     * the focus as it was made active again, it gave it to its first control
     * with its text selected, and what was typed next took its place. */
    it("gives Notepad's Find box its focus back after Cannot find", async () => {
      let focus: any = null;
      let find: any = null;
      const { trees } = await session('NOTEPAD.EXE', [
        step(typed('abc')),
        step('Alt_L+s'),
        step('f', 2),
        step(typed('xyz\n'), 2),
        step('Return', 2, (win16) => {
          focus = win16.rasterDesktop.focus;
          find = win16.rasterDesktop.windows.find((w: any) => w.title === 'Find' && w.visible);
        }),
        step(typed('q')),
      ]);

      expect(nodes(trees[3]).some((node) => /Cannot find/.test(node.name ?? ''))).toBe(true);
      expect(find).toBeTruthy();
      expect(focus?.parent).toBe(find);
      expect(focus?.controlId).toBe(0x480);
      expect(fields(trees[5], 'Find')).toEqual(['xyzq']);
    }, 300000);

    /* A group's icon, clicked, opened Program Manager's own system menu, and
     * twice did not restore the group (seg6 `1389`). */
    it("restores a Program Manager group's icon double-clicked", async () => {
      let width = 0;

      await session('PROGMAN.EXE', [
        step('dblclick:110,325', 2, (win16) => {
          width =
            win16.rasterDesktop.windows.find((w: any) => w.title === 'Accessories')?.width ?? 0;
        }),
      ]);

      expect(width).toBeGreaterThan(36);
    }, 300000);
  }
);
