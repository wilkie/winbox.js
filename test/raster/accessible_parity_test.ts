'use strict';

import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IMAGE, PROBES, runProbe } from '../win16/run-probe.js';

/**
 * The accessibility tree the two engines make of the same run at the same
 * places: the TypeScript engine's here, kept in `accessible-trees/` with the
 * places it was kept at; the Rust engine's against the same files, at the
 * same places, by `crates/winbox-win16/tests/accessible_parity.rs`.
 *
 * Each place is either a screen a step keeps -- after the program has run
 * for a while, and after each step's keys -- or a call the run picks,
 * before it is made. The places are written as the corpus's reports write
 * theirs (`stepMarks`), which the Rust engine's survey reads to press the
 * same keys and keep its own tree at the same instruction.
 *
 * The files are the TypeScript engine's trees as they are at the commit:
 * this test holds the engine to them, and `WINBOX_TREES=write` writes them
 * again where a change to the engine is meant to change them. A window's
 * key is the desktop's own number for it, which the two engines give
 * alike, in the order the windows are made; no window handle is written.
 */

const ROOT = join(__dirname, '..', '..');
const TREES = join(__dirname, 'accessible-trees');
const WINDOWS = join(ROOT, 'oracle', 'build', 'drive-c', 'WINDOWS');
const CORPUS = join(ROOT, 'corpus', 'programs');

/** A step as `record.mjs --then` writes one: keys, then seconds. */
const step = (keys: string, seconds: number) => ({
  keys: keys ? keys.split(',') : [],
  seconds,
});

/** What runs: a probe, a program of the installation's, or one of the corpus's. */
type Run =
  | { probe: string }
  | { windows: string; path: string }
  | { corpus: string; file: string; path: string };

interface Scenario {
  id: string;
  run: Run;
  seconds: number;
  steps: { keys: string[]; seconds: number }[];
  treeAt?: (call: any, count: number) => boolean;
}

const SCENARIOS: Scenario[] = [
  /* Notepad: text typed, its File menu opened from the keyboard, the
   * selection moved to Edit's -- whose items have accelerators -- and both
   * menus closed. */
  {
    id: 'notepad',
    run: { windows: 'NOTEPAD.EXE', path: 'C:\\CORPUS\\NOTEPAD\\NOTEPAD.EXE' },
    seconds: 3,
    steps: [
      step('h,i', 1),
      step('Alt_L,f', 1),
      step('Down', 1),
      step('Right', 1),
      step('Escape,Escape', 1),
    ],
  },
  /* Clock, its Settings menu opened from the keyboard and closed, and its
   * system menu opened with Alt and space, and closed. */
  {
    id: 'clock',
    run: { windows: 'CLOCK.EXE', path: 'C:\\CORPUS\\CLOCK\\CLOCK.EXE' },
    seconds: 3,
    steps: [
      step('Alt_L,Down', 1),
      step('Escape,Escape', 1),
      step('Alt_L+space', 1),
      step('Escape', 1),
    ],
  },
  /* A dialog of static text, an edit control, a check box, radio buttons and
   * push buttons, as the keyboard moves through it, and its modal run. */
  {
    id: 'dialogs',
    run: { probe: 'dialogs' },
    seconds: 30,
    steps: [],
    treeAt: (call) => ['PostMessage', 'DestroyWindow', 'EndDialog'].includes(call.name),
  },
  /* One of each of USER's controls: edit, multi-line edit, static, push
   * button, check box, radio button, group box, list box and scroll bar. */
  {
    id: 'ctlcolor',
    run: { probe: 'ctlcolor' },
    seconds: 30,
    steps: [],
    treeAt: (call) => call.name === 'DestroyWindow',
  },
  /* A program of the corpus with a menu bar. */
  {
    id: 'reversi',
    run: { corpus: 'reversi', file: 'REVERSI.EXE', path: 'C:\\CORPUS\\REVERSI\\REVERSI.EXE' },
    seconds: 3,
    steps: [step('', 0.5), step('Alt_L,g', 1)],
  },
];

/** Whether what a scenario runs is here. */
function present(run: Run) {
  if ('probe' in run) {
    return existsSync(join(PROBES, `${run.probe.toUpperCase()}.EXE`));
  }

  if ('windows' in run) {
    return existsSync(join(WINDOWS, run.windows));
  }

  return existsSync(join(CORPUS, run.corpus, run.file));
}

/** A scenario run on the TypeScript engine: its places, and its tree at each. */
async function treesOf(scenario: Scenario) {
  const { run } = scenario;
  /* A program of the installation is copied into a folder of its own,
   * where the corpus's programs are put, as the Rust engine's run puts it. */
  const copied = 'windows' in run ? mkdtempSync(join(tmpdir(), `winbox-${scenario.id}-`)) : null;

  try {
    if (copied && 'windows' in run) {
      copyFileSync(join(WINDOWS, run.windows), join(copied, run.windows));
    }

    const program =
      'windows' in run
        ? { directory: copied!, file: run.windows, folder: run.path.split('\\')[2] }
        : 'corpus' in run
          ? { directory: join(CORPUS, run.corpus), file: run.file, folder: run.path.split('\\')[2] }
          : null;
    const ran: any = await runProbe(
      'probe' in run ? run.probe : scenario.id,
      0,
      false,
      true,
      scenario.seconds,
      {
        program,
        virtual: true,
        keepCalls: 0,
        steps: scenario.steps,
        trees: true,
        treeAt: scenario.treeAt ?? null,
      }
    );

    /* Each tree as `JSON.stringify` writes it, the very text the other
     * engine's must be. */
    return {
      stepMarks: ran.stepMarks,
      trees: ran.trees.map((tree: any) => JSON.stringify(tree)),
      callCount: ran.callCount,
    };
  } finally {
    if (copied) {
      rmSync(copied, { recursive: true, force: true });
    }
  }
}

(existsSync(IMAGE) ? describe : describe.skip)(
  'the accessibility tree, as the Rust engine is held to it',
  () => {
    for (const scenario of SCENARIOS) {
      const test = present(scenario.run) ? it : it.skip;

      test(`is kept for ${scenario.id}`, async () => {
        const { stepMarks, trees, callCount } = await treesOf(scenario);
        const file = join(TREES, `${scenario.id}.json`);
        const seconds =
          scenario.seconds + scenario.steps.reduce((sum, each) => sum + each.seconds, 0);

        expect(trees.length).toBeGreaterThan(0);
        expect(trees.length).toBe(stepMarks.filter((mark: any) => !mark.key).length);

        if (process.env.WINBOX_TREES === 'write') {
          writeFileSync(
            file,
            `${JSON.stringify({ run: scenario.run, seconds, calls: callCount, stepMarks, trees }, null, 2)}\n`
          );
        }

        const kept = JSON.parse(readFileSync(file, 'utf8'));

        expect(trees).toEqual(kept.trees);
      }, 300_000);
    }
  }
);
