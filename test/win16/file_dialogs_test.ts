'use strict';

import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IMAGE, PROBES, outputOf, recordsFrom, runProbe } from './run-probe.js';

/**
 * Notepad's File Open, COMMDLG.DLL's own dialog from the installation, used
 * as a person at the page uses it: a directory double-clicked to go into it,
 * a file clicked to take its name, the drives' list dropped and a drive
 * chosen, and the keyboard moving between the controls. The Rust engine's
 * `crates/winbox-web/tests/file_dialogs.rs` does the same.
 *
 * None of it once answered but the file list: a press moved the focus
 * itself, as it was taken, without `WM_KILLFOCUS` or `WM_SETFOCUS`, so the
 * list box pressed found it had the focus already and told no one --
 * COMMDLG's directory list draws its selection only while it has the focus
 * -- and USER's own classes had no style, so no list box was sent
 * `WM_LBUTTONDBLCLK` and no directory could be gone into. USER registers
 * `ListBox` with `CS_DBLCLKS` (`USER.EXE` seg3 `171d`). `filedlg` recorded
 * the dialog so used under Windows.
 *
 * Notepad runs from `C:\CORPUS\NOTEPAD`, so the dialog opens there. The
 * dialog is at (64,57) on the VGA: its directories' rows, 16 high, from 133
 * down at 261 across; its files', 13 high, from 133 at 79; the drives'
 * button at (414,276), and the list it drops from 287.
 */

const WINDOWS = join(__dirname, '..', '..', 'oracle', 'build', 'drive-c', 'WINDOWS');

/** A step: keys and clicks, `;` between them, then the seconds run on. */
const step = (keys: string, seconds = 1, then?: (win16: any) => void) => ({
  keys: keys.split(';'),
  seconds,
  then,
});

/** The dialog's controls in a tree, in their order in its template. */
function dialog(tree: any) {
  const open = tree.nodes.find((node: any) => node.name === 'Open');

  if (!open) {
    return null;
  }

  const children = open.children;
  const lists = children.filter((node: any) => node.role === 'listbox');
  const dirs = lists[1];

  return {
    name: children.find((node: any) => node.role === 'textbox')?.value,
    files: lists[0].children.map((node: any) => node.name),
    dirs: dirs.children.map((node: any) => node.name),
    directory: children[children.indexOf(dirs) - 1].name,
    focus: tree.focus === dirs.key ? 'dirs' : tree.focus === lists[0].key ? 'files' : tree.focus,
  };
}

/** Notepad run, its File Open opened from the keyboard, then the steps: the tree after each. */
async function opened(steps: { keys: string[]; seconds: number; then?: (win16: any) => void }[]) {
  const copied = mkdtempSync(join(tmpdir(), 'winbox-filedlg-'));

  try {
    copyFileSync(join(WINDOWS, 'NOTEPAD.EXE'), join(copied, 'NOTEPAD.EXE'));

    const ran: any = await runProbe('notepad', 0, false, true, 3, {
      program: { directory: copied, file: 'NOTEPAD.EXE', folder: 'NOTEPAD' },
      virtual: true,
      keepCalls: 0,
      steps: [step('Alt_L;f'), step('o', 2), ...steps],
      trees: true,
    });

    return ran.trees.slice(3);
  } finally {
    rmSync(copied, { recursive: true, force: true });
  }
}

(existsSync(IMAGE) && existsSync(join(WINDOWS, 'NOTEPAD.EXE')) ? describe : describe.skip)(
  "Notepad's File Open",
  () => {
    it('goes into a directory double-clicked, and opens a file clicked', async () => {
      const [root, windows, clicked, done] = await opened([
        step('dblclick:300,141'),
        step('dblclick:300,189'),
        step('click:110,152'),
        step('Return', 2),
      ]);

      expect(dialog(root)).toEqual({
        name: '*.txt',
        files: [],
        dirs: ['C:\\', 'CORPUS', 'ORACLE', 'WINDOWS'],
        directory: 'c:\\',
        focus: 'dirs',
      });
      expect(dialog(windows)).toMatchObject({
        files: ['BOOTLOG.TXT', 'SETUP.TXT'],
        directory: 'c:\\windows',
      });
      expect(dialog(clicked)).toMatchObject({ name: 'setup.txt', focus: 'files' });
      expect(dialog(done)).toBe(null);
      expect(done.nodes.map((node: any) => node.name)).toContain('Notepad - SETUP.TXT');
    }, 300000);

    it('moves between its controls with Tab, and goes into a directory with the arrows and Enter', async () => {
      const [first, second, , entered] = await opened([
        step('Tab'),
        step('Tab'),
        step('Up'),
        step('Return'),
      ]);

      expect(dialog(first)?.focus).toBe('files');
      expect(dialog(second)?.focus).toBe('dirs');
      expect(dialog(entered)).toMatchObject({
        dirs: ['C:\\', 'CORPUS', 'NOTEPAD'],
        directory: 'c:\\corpus',
      });
    }, 300000);

    it('drops the drives and takes the drive chosen', async () => {
      /* Whether the drives' list shows, below the combo box. */
      const showing = (win16: any) =>
        win16.rasterDesktop.windows.some(
          (window: any) => window.visible && window.control?.className === 'COMBOLBOX'
        );
      let dropped = false;
      let after = true;
      const [root, , chosen] = await opened([
        step('dblclick:300,141'),
        step('click:414,276', 1, (win16) => (dropped = showing(win16))),
        step('click:300,296', 1, (win16) => (after = showing(win16))),
      ]);

      expect(dialog(root)?.directory).toBe('c:\\');
      expect([dropped, after]).toEqual([true, false]);
      expect(dialog(chosen)).toMatchObject({
        dirs: ['C:\\', 'CORPUS', 'ORACLE', 'WINDOWS'],
        directory: 'c:\\',
      });
    }, 300000);
  }
);

/**
 * Media Player's File Open: the same dialog, with a hook of Media Player's
 * that enables the file controls for the type of file chosen, from its own
 * table of devices (`MPLAYER.EXE` seg2 `023c`). Media Player is linked with
 * a single data segment (flags 0309h), and winbox.js left its exported
 * hook's prologue as `mov ax, ds` and gave it no thunk: called by `COMMDLG`,
 * the hook read `COMMDLG`'s data as its table and disabled the name, both
 * lists and the drives, and nothing in the dialog answered a click. KERNEL
 * counts every program as having multiple data (`KRNL386.EXE` seg2 `17ee`).
 *
 * This engine has no sound card, so Media Player finds no device it can
 * play and says so in a box of its own; the `mplopen` probe opens the
 * dialog from outside meanwhile, as Windows let it (`mplopen.json`), and
 * reads which of its controls are enabled. The Rust engine's
 * `file_dialogs.rs` goes on to open a sound, with its sound card.
 */
(existsSync(IMAGE) && existsSync(join(PROBES, 'MPLOPEN.EXE')) ? describe : describe.skip)(
  "Media Player's File Open",
  () => {
    it('leaves its controls enabled for all files', async () => {
      const { fileSystem } = await runProbe('mplopen', 4000, false, true, 30, {});
      const records = recordsFrom((await outputOf(fileSystem, 'mplopen')) ?? '');

      expect(records).toContain('dialog() = found');
      expect(records).toContain('types() = sel=0|All files (*.*)');
      expect(records).toContain('enabled(open) = 442=1,480=1,460=1,461=1,440=1,471=1,470=1');
    }, 300000);
  }
);
