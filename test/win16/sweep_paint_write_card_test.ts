'use strict';

import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IMAGE, runProbe } from './run-probe.js';

/**
 * A second sweep through Paintbrush, Write and Cardfile, used as a person at
 * the page uses them, and held to what shows and what they wrote. The Rust
 * engine's `crates/winbox-web/tests/sweep_paint_write_card.rs` does the same
 * and more. Each program runs from `C:\CORPUS\SWEEP`, where what it saves
 * goes.
 */

const WINDOWS = join(__dirname, '..', '..', 'oracle', 'build', 'drive-c', 'WINDOWS');

/** A step: keys and clicks, `;` between them, then the seconds run on. */
const step = (keys: string, seconds = 1, then?: (win16: any) => void) => ({
  keys: keys.split(';'),
  seconds,
  then,
});

/** Letters, digits and Return typed, as keysyms. */
const typed = (text: string) =>
  [...text]
    .map((c) =>
      c === '\n' ? 'Return' : c === ' ' ? 'space' : c === '.' ? '.' : c === '\\' ? 'backslash' : c
    )
    .join(';');

/** A program of the installation run, the steps taken: its trees after each, and a file it wrote. */
async function session(
  program: string,
  steps: { keys: string[]; seconds: number; then?: (win16: any) => void }[],
  read?: string
) {
  const copied = mkdtempSync(join(tmpdir(), 'winbox-sweep-'));

  try {
    copyFileSync(join(WINDOWS, program), join(copied, program));

    const ran: any = await runProbe('sweep', 0, false, true, 3, {
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

/** Whether a tree has a node whose name has `part` in it. */
const says = (tree: any, part: string) =>
  nodes(tree).some((node) => String(node.name ?? '').includes(part));

/** The screen's colour at a point, as red, green and blue. */
function colourAt(win16: any, x: number, y: number) {
  const screen = win16.rasterDesktop.screen;

  return screen.devicePalette.colours[screen.indices[y * 640 + x]].slice(0, 3);
}

const RED = [255, 0, 0];
const BLUE = [0, 0, 255];

/** A filled box drawn in Paintbrush in the palette's red. */
const redBox = (from: string, to: string) =>
  step(`click:220,372;click:49,214;drag:${from},${to}`);

(existsSync(IMAGE) && existsSync(join(WINDOWS, 'PBRUSH.EXE')) ? describe : describe.skip)(
  'Paintbrush, Write and Cardfile, used',
  () => {
    /* Tab in a combo box's edit control in Paintbrush's Font box went nowhere:
     * USER takes the focus to the dialog's control it is in, the combo box,
     * first (`USER.EXE` seg19 `0a02`, seg25 `0f8c`). And `GetDlgItemInt` read
     * the combo box's own text, empty, where it asks for it with `WM_GETTEXT`
     * (seg25 `0233`): "Size must be a number." */
    it("tabs to the size in Paintbrush's Font box and reads it", async () => {
      const focus: number[] = [];
      const owner = (win16: any) => {
        const at = win16.rasterDesktop.focus;

        focus.push(at?.parent?.controlId ?? 0);
      };
      const { trees } = await session('PBRUSH.EXE', [
        step('Alt_L+t;f', 2, owner),
        step(typed('Arial')),
        step('Tab', 1, owner),
        step('Tab', 1, owner),
        step(typed('24')),
        step('Return', 2),
      ]);

      expect(focus).toEqual([0x470, 0x471, 0x472]);
      expect(says(trees[5], 'Size must be a number')).toBe(false);
      expect(nodes(trees[5]).some((node) => node.name === 'Font')).toBe(false);
    }, 300000);

    /* Over a dialog's controls, the arrow and an edit control's I-beam: USER
     * registers its classes with them (seg3 `162f`, `16f1`), and the hourglass
     * Paintbrush shows as it opens a dialog stayed. */
    it("shows the arrow and the I-beam over Paintbrush's dialogs", async () => {
      const cursors: number[] = [];
      const cursor = (win16: any) => cursors.push(win16.handles.resolve(win16._cursor)?.id ?? 0);

      await session('PBRUSH.EXE', [
        step('Alt_L+o;i', 2),
        step('move:426,171', 1, cursor),
        step('move:250,197', 1, cursor),
      ]);

      expect(cursors).toEqual([32512, 32513]);
    }, 300000);

    /* Control and V right after Control and C: `TranslateAccelerator` tells
     * the window `WM_INITMENU` and `WM_INITMENUPOPUP` before it looks whether
     * Paste is grayed (seg19 `06d2`; `accinit`). */
    it('pastes in Paintbrush with Control and V after copying', async () => {
      const seen: number[][] = [];

      await session('PBRUSH.EXE', [
        redBox('400,250', '460,300'),
        step('click:49,59;drag:395,245,465,305'),
        step('Control_L+c', 1, (win16) => seen.push(colourAt(win16, 90, 70))),
        step('Control_L+v', 2, (win16) => seen.push(colourAt(win16, 90, 70))),
      ]);

      expect(seen).toEqual([[255, 255, 255], RED]);
    }, 300000);

    /* Paintbrush writes its picture in pieces of 61,440 bytes through one far
     * pointer moved on, the second past its segment's first 64 KiB, which
     * `_lwrite` took from the segment's start (`KRNL386.EXE` seg1 `0c42`;
     * `lwrhuge`). */
    it('saves the whole of a Paintbrush picture', async () => {
      const { file } = await session(
        'PBRUSH.EXE',
        [redBox('300,250', '400,320'), step('Alt_L+f;a', 2), step(typed('whole.bmp\n'), 3)],
        'WHOLE.BMP'
      );

      expect(file?.length).toBe(141558);

      const offset = file!.readUInt32LE(10);
      const byte = file![offset + (441 - 240) * 320 + (283 >> 1)];
      const index = 283 % 2 ? byte & 15 : byte >> 4;

      expect([...file!.subarray(54 + index * 4, 54 + index * 4 + 3)]).toEqual([0, 0, 255]);
    }, 300000);

    /* An underline is drawn in the text colour (`ulcolour`): Paintbrush draws
     * its text white on black in a monochrome bitmap, where black showed
     * nothing. */
    it("underlines Paintbrush's text", async () => {
      let longest = 0;

      await session('PBRUSH.EXE', [
        step('click:352,372;click:49,90;click:120,80'),
        step('Alt_L+t;u'),
        step(typed('Hi there'), 2, (win16) => {
          for (let y = 75; y < 110; y++) {
            let run = 0;

            for (let x = 110; x < 240; x++) {
              run = String(colourAt(win16, x, y)) === String(BLUE) ? run + 1 : 0;
              longest = Math.max(longest, run);
            }
          }
        }),
      ]);

      expect(longest).toBeGreaterThanOrEqual(40);
    }, 300000);

    /* Write's text selected by dragging: Write follows the mouse while
     * `GetKeyState` says the left button is down, and USER moves a button's
     * state with its message as a key's (`USER.EXE` seg1 `4ecc`). */
    it('selects Write text by dragging', async () => {
      const { file } = await session(
        'WRITE.EXE',
        [
          step(typed('Hello world.\nSecond line.')),
          step('drag:26,56,26,72'),
          step(typed('X')),
          step('Alt_L+f;a', 2),
          step(typed('drag\n'), 2),
        ],
        'DRAG.WRI'
      );

      expect(file?.includes('XSecond')).toBe(true);
      expect(file?.includes('Hello')).toBe(false);
    }, 300000);

    /* Cardfile's File Merge parses the file's name with `OF_PARSE`, which
     * answers nought and opens nothing (`KRNL386.EXE` seg1 `53f1`); the handle
     * of a file opened was "Filename not valid". */
    it('merges a second file into Cardfile', async () => {
      const { trees, file } = await session(
        'CARDFILE.EXE',
        [
          step('F6', 2),
          step(typed('Apple\n')),
          step('F7', 2),
          step(typed('Banana\n')),
          step('Alt_L+f;a', 2),
          step(typed('one.crd\n'), 2),
          step('Alt_L+f;n', 2),
          step('F6', 2),
          step(typed('Cherry\n')),
          step('Alt_L+f;m', 2),
          step(typed('one.crd\n'), 3),
          step('Alt_L+f;a', 2),
          step(typed('two.crd\n'), 2),
        ],
        'TWO.CRD'
      );

      expect(says(trees[10], 'Filename not valid')).toBe(false);
      expect(says(trees[10], '3  Cards')).toBe(true);
      expect(file?.subarray(0, 3).toString('latin1')).toBe('MGC');
      expect(file?.readUInt16LE(3)).toBe(3);
    }, 300000);
  }
);
