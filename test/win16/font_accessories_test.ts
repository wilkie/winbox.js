'use strict';

import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IMAGE, runProbe } from './run-probe.js';

/**
 * COMMDLG's Font dialog, `ChooseFont`, as Windows 3.1's own programs open it
 * -- Write's Character ▸ Fonts, Paintbrush's Text ▸ Fonts, File Manager's
 * Options ▸ Font and Clock's Settings ▸ Set Font -- used as a person at the
 * page uses it, with `COMMDLG.DLL` on the drive and without it, when
 * WinBox's own `ChooseFont` runs alone. As
 * `crates/winbox-web/tests/font_accessories.rs`.
 */

const WINDOWS = join(__dirname, '..', '..', 'oracle', 'build', 'drive-c', 'WINDOWS');
const NO_COMMDLG = [['WINDOWS', 'SYSTEM', 'COMMDLG.DLL']];

/** A step: keys, `;` between them, then the seconds run on. */
const step = (keys: string, seconds = 1, then?: (win16: any) => void) => ({
  keys: keys.split(';'),
  seconds,
  then,
});

/** Letters, digits, spaces and Return typed, as keysyms. */
const typed = (text: string) =>
  [...text].map((c) => (c === '\n' ? 'Return' : c === ' ' ? 'space' : c)).join(';');

/** A program of the installation run, the steps taken: its trees after each, and a file it wrote. */
async function session(
  program: string,
  steps: { keys: string[]; seconds: number; then?: (win16: any) => void }[],
  read?: string,
  without: string[][] = []
) {
  const copied = mkdtempSync(join(tmpdir(), 'winbox-fonts-'));

  try {
    copyFileSync(join(WINDOWS, program), join(copied, program));

    const ran: any = await runProbe('accessories', 0, false, true, 3, {
      program: { directory: copied, file: program, folder: 'SWEEP' },
      virtual: true,
      keepCalls: 0,
      steps,
      trees: true,
      without,
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

/** The texts of the Font dialog's three boxes -- the face, the style and the size -- or null with no dialog of that title. */
function boxes(win16: any, title = 'Font') {
  const windows = win16.rasterDesktop.windows;
  const dialog = windows.find((w: any) => w.visible && w.title === title && !w.parent);

  return dialog
    ? windows
        .filter(
          (w: any) => w.control?.className?.toUpperCase() === 'EDIT' && w.parent?.parent === dialog
        )
        .map((w: any) => w.control.text)
    : null;
}

(existsSync(IMAGE) && existsSync(join(WINDOWS, 'WRITE.EXE')) ? describe : describe.skip)(
  "Windows' accessories' Font dialog",
  () => {
    /* Write's Character ▸ Fonts with COMMDLG.DLL on the drive: WinBox's own
     * ChooseFont, the face typed whole and chosen (`CBN_EDITUPDATE` and
     * COMMDLG's posted 5F5h), OK, and the text typed after it saved in that
     * face. */
    it("chooses a face in Write's Fonts and saves the text in it", async () => {
      const seen: (string[] | null)[] = [];
      const note = (win16: any) => seen.push(boxes(win16));
      const { trees, file } = await session(
        'WRITE.EXE',
        [
          step('Alt_L+c'),
          step('f', 2, note),
          step('Alt_L+f;' + typed('times new roman'), 2, note),
          step('Return', 2, note),
          step(typed('Hello')),
          step('Alt_L+f'),
          step('a', 2),
          step(typed('doc\n'), 2),
        ],
        'DOC.WRI'
      );

      expect(seen[0]).toEqual(['Arial', 'Regular', '10']);
      expect(seen[1]).toEqual(['Times New Roman', 'Regular', '10']);
      expect(seen[2]).toBeNull();
      expect(nodes(trees[1]).some((node) => node.name === 'Sample')).toBe(true);
      expect(file?.includes('Times New Roman')).toBe(true);
      expect(file?.includes('Hello')).toBe(true);
    }, 300000);

    /* Each program's font chosen with no COMMDLG.DLL on the drive -- WinBox's
     * ChooseFont alone, its template, strings and pictures its own -- and
     * the dialog opened again showing what the program kept. */
    for (const [program, menu, face, before, after] of [
      ['PBRUSH.EXE', 'Alt_L+t', 'arial', ['System', 'Bold', '12'], ['Arial', 'Bold', '12']],
      [
        'WINFILE.EXE',
        'Alt_L+o',
        'courier new',
        ['MS Sans Serif', 'Regular', '8'],
        ['Courier New', 'Regular', '8'],
      ],
      [
        'CLOCK.EXE',
        'Alt_L+s',
        'times new roman',
        ['Arial', 'Regular', '16'],
        ['Times New Roman', 'Regular', '16'],
      ],
    ] as [string, string, string, string[], string[]][]) {
      it(`chooses a font in ${program} with no COMMDLG.DLL on the drive`, async () => {
        const seen: (string[] | null)[] = [];
        const note = (win16: any) => seen.push(boxes(win16));

        await session(
          program,
          [
            step(menu),
            step('f', 2, note),
            step('Alt_L+f;' + typed(face), 2, note),
            step('Return', 2, note),
            step(menu),
            step('f', 2, note),
            step('Escape', 2, note),
          ],
          undefined,
          NO_COMMDLG
        );

        expect(seen[0]).toEqual(before);
        expect(seen[1]?.[0]).toBe(after[0]);
        expect(seen[2]).toBeNull();
        expect(seen[3]).toEqual(after);
        expect(seen[4]).toBeNull();
      }, 300000);
    }
  }
);
