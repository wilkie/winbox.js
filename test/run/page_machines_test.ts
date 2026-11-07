import { baseName } from '../../src/layers/layer.js';
import {
  current,
  identityOf,
  type Machine,
  machineOf,
  machines,
  nameOf,
  pageView,
  programOf,
  publish,
  runningOn,
  show,
  state,
  status,
  statusLine,
} from '../../src/run/page/state.js';
import {
  assetsIdentity,
  changesKey,
  type KeptProgram,
  programIdentity,
} from '../../src/run/store.js';

/**
 * The page's machines (`src/run/page/state.ts`; `kb/guides/launcher.md`,
 * design A): each a Windows of its own, a tab, its stack the kept program
 * it runs on the display it was made on, or the base; no two keeping what
 * they write in one place; the side, the trace and the status line
 * speaking for the one shown.
 */

/** A machine as the page holds one, with no engine: what the state reads of it. */
function machine(id: number, more: Partial<Machine> = {}): Machine {
  return {
    id,
    program: null,
    display: 'vga',
    coprocessor: true,
    sound: false,
    installing: null,
    driveOffer: null,
    drives: [],
    drivePrograms: new Map(),
    driveVolumes: new Map(),
    engine: new Promise(() => {}),
    made: null,
    built: null,
    plan: null,
    kept: { installation: null, changes: [] },
    given: [],
    tooLarge: [],
    generation: 0,
    rebuilding: false,
    keeping: null,
    closed: false,
    desktop: null as unknown as HTMLElement,
    counts: new Map(),
    recent: [],
    traceFrame: 0,
    ...more,
  };
}

const kept = (name: string, display = 'vga'): KeptProgram => ({
  name,
  base: baseName('abc', display),
  display,
  layers: [`${name}-layer`],
  exes: [],
  orders: {},
  kept: 0,
});

describe('the run page, its machines', () => {
  beforeEach(() => {
    machines.splice(0);
    show(null);
    state.windows = null;
    state.installation = null;
    state.assets = {
      id: 'abc',
      manifest: { id: 'abc', sources: [], displays: ['vga', 'ega'] },
    } as any;
    state.displays = ['vga', 'ega'];
    state.programs = [kept('pmitem'), kept('clock'), kept('egaonly', 'ega')];
  });

  it('runs a kept program on the display it was made on, else the base there', () => {
    const pmitem = machine(1, { program: 'pmitem' });
    const elsewhere = machine(2, { program: 'pmitem', display: 'ega' });
    const base = machine(3);

    machines.push(pmitem, elsewhere, base);

    expect(programOf(pmitem)?.name).toBe('pmitem');
    expect(programOf(elsewhere)).toBe(null);
    expect(identityOf(pmitem)).toBe(
      programIdentity('pmitem', baseName('abc', 'vga'), 'vga', ['pmitem-layer'])
    );
    /* The base differs with the display, and so what is written on it. */
    expect(identityOf(elsewhere)).toBe(assetsIdentity('abc', 'ega'));
    expect(identityOf(base)).toBe(assetsIdentity('abc', 'vga'));
    expect(nameOf(pmitem)).toBe('pmitem');
    expect(nameOf(base)).toBe('Windows');
  });

  it('finds the machine running a stack, so that no two keep what they write in one place', () => {
    const pmitem = machine(1, { program: 'pmitem' });
    const base = machine(2);
    const installing = machine(3, {
      installing: {
        name: 'clock',
        from: 'clock.zip',
        media: null,
        drive: null,
        installer: '',
        into: null,
        ended: false,
      },
    });
    const closed = machine(4, { program: 'clock', closed: true });

    machines.push(pmitem, base, installing, closed);

    expect(machineOf('pmitem')).toBe(pmitem);
    expect(machineOf('clock')).toBe(null);
    expect(runningOn(identityOf(pmitem))).toBe(pmitem);
    expect(runningOn(identityOf(pmitem), pmitem)).toBe(null);
    /* The base on the VGA runs on one machine; on the EGA on none. */
    expect(runningOn(assetsIdentity('abc', 'vga'))).toBe(base);
    expect(runningOn(assetsIdentity('abc', 'ega'))).toBe(null);
    /* A program's changes are kept by its name, whatever its layers. */
    expect(changesKey(programIdentity('pmitem', 'x', 'vga', ['another']))).toBe(
      changesKey(identityOf(pmitem))
    );
    expect(runningOn(programIdentity('pmitem', 'x', 'vga', ['another']))).toBe(pmitem);
  });

  it('speaks for the machine shown, and names the others in the status line', () => {
    const pmitem = machine(1, { program: 'pmitem' });
    const clock = machine(2, { program: 'clock', display: 'vga' });

    machines.push(pmitem, clock);
    state.programs = state.programs.filter((one) => one.name !== 'egaonly');
    expect(current()).toBe(pmitem);

    show(clock);
    expect(current()).toBe(clock);

    status('The program has ended, with exit code 0.', 'info', clock);
    expect(statusLine.get().message).toBe('The program has ended, with exit code 0.');
    status('The program has ended, with exit code 0.', 'info', pmitem);
    expect(statusLine.get().message).toBe('pmitem: The program has ended, with exit code 0.');
    status('Ready.');
    expect(statusLine.get().message).toBe('Ready.');

    /* Shown: its tab selected, the side's display and drives its own. */
    state.programs = [];
    clock.display = 'ega';
    clock.drives.push({ letter: 'A', kind: 'floppy', disks: [], current: 0, ejected: true });
    publish();

    const view = pageView.get()!;

    expect(view.tabs.map((tab) => [tab.id, tab.name, tab.selected])).toEqual([
      [1, expect.stringMatching(/^Windows \(VGA/), false],
      [2, expect.stringMatching(/^Windows \(EGA/), true],
    ]);
    expect(view.display).toBe('ega');
    expect(view.drives.map((row) => row.letter)).toEqual(['A']);

    /* The machine shown closed: the first is spoken for. */
    clock.closed = true;
    expect(current()).toBe(pmitem);
  });
});
