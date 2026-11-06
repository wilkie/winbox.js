'use strict';

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { STAMP } from '../../src/assets/compose.js';
import { installedLayer } from '../../src/layers/install.js';
import { programGroups } from '../../src/layers/groups.js';
import { launchGroups } from '../../src/layers/launch.js';
import { baseName, flattenStack } from '../../src/layers/layer.js';
import { DevicePalette } from '../../src/raster/device-palette.js';
import { decodeIcon, iconEntries, pickIcon } from '../../src/raster/icon.js';
import { iconIndices } from '../../src/run/group-icon.js';
import { resourcesOf } from '../../src/win16/ne-resources.js';
import { Fat16Changes } from '../../src/run/changes.js';
import { type Plan } from '../../src/run/drive.js';
import { bundle, runProbe } from '../win16/run-probe.js';
import { shellAlone } from '../../src/win16/progman/main.js';

/**
 * A program of the corpus installed by its own installer into a layer
 * (`kb/formats/layer.md`, "An installer into a layer"): Caribbean
 * Treasure's SETUP.EXE, its media -- the archive's three files -- placed at
 * `C:\CARIBB` on the asset bundle's base for the VGA under an empty top, on
 * the virtual clock. Its steps are a person's: "Install Caribbean
 * Treasure", OK to `c:\windows\games`, Yes to make it, and Enter on the
 * last page. Its top's changes are made a layer over the base, the media
 * dropped, and held to `test/layers/caribb-layer.json` -- which the Rust
 * engine's run of the same installer, its clicks and keys where this run
 * made them (`stepMarks`), is held to as well
 * (`crates/winbox-win16/tests/install_caribb.rs`). It runs as the page
 * runs an installer: WinBox's Program Manager the shell, started first and
 * starting it (`startShell`), there being none on the base. The installer
 * asks it over DDE for its group, so the layer holds `PROGMAN.INI` and
 * `GAMES.GRP` with what it installed.
 *
 * Skipped without the corpus's program or the bundle; `CARIBB_LAYER_WRITE=1`
 * writes the fixture from this run.
 */

const ROOT = join(__dirname, '..', '..');
const MEDIA = join(ROOT, 'corpus', 'programs', 'caribb');
const FIXTURE = join(__dirname, 'caribb-layer.json');
const ready = existsSync(join(MEDIA, 'SETUP.EXE')) && bundle() !== null;

/** The steps, as a person took them: where each click went, and how long after. */
const STEPS = [
  { keys: ['click:320,272'], seconds: 5 },
  { keys: ['click:463,210'], seconds: 5 },
  { keys: ['click:285,303'], seconds: 150 },
  { keys: ['Return'], seconds: 10 },
];

(ready ? describe : describe.skip)("Caribbean Treasure's installer into a layer", () => {
  it('installs into a layer the Rust engine makes too', async () => {
    let changes: Fat16Changes | null = null;
    const run = await runProbe('caribb', 3000, false, true, 10, {
      boxKeys: [['Enter'], ['Enter'], ['Enter']],
      virtual: true,
      keepCalls: 0,
      base: 'assets',
      display: 'vga',
      own: false,
      brought: false,
      start: 'C:\\CARIBB\\SETUP.EXE',
      install: true,
      markPointers: true,
      shell: false,
      steps: STEPS,
      prepare: async (fileSystem) => {
        for (const name of readdirSync(MEDIA).sort()) {
          const data = new Uint8Array(readFileSync(join(MEDIA, name)));

          await fileSystem.map(
            ['CARIBB', name.toUpperCase()],
            new DataView(data.buffer, data.byteOffset, data.byteLength),
            { modified: STAMP, archive: true }
          );
        }

        changes = new Fat16Changes(fileSystem, { placements: [] } as unknown as Plan);
        await changes.mark();
      },
    });

    expect(run.failure ?? null).toBeNull();

    const installed = await installedLayer(await changes!.changes(), {
      media: ['CARIBB'],
      over: [baseName(bundle()!.id, 'vga')],
      made: { by: 'WinBox', from: 'CARIBB.ZIP' },
    });
    const made = {
      stepMarks: run.stepMarks,
      layer: installed.layer.manifest,
      dropped: installed.dropped,
      references: installed.references,
    };

    if (process.env.CARIBB_LAYER_WRITE === '1' || !existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, `${JSON.stringify(made, null, 1)}\n`);
    }

    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));

    /* The installer ended, its task gone, once Enter was pressed: Program
     * Manager, the shell, alone left. */
    expect(shellAlone(run.win16)).toBe(true);
    /* The group the installer asked Program Manager for, in the layer. */
    const paths = made.layer.entries.map((entry: any) => entry.path);

    expect(paths).toContain('WINDOWS\\PROGMAN.INI');
    expect(paths).toContain('WINDOWS\\GAMES.GRP');
    expect(made.layer).toEqual(fixture.layer);
    expect(made.dropped).toEqual(fixture.dropped);
    expect(made.references).toEqual(fixture.references);

    /* The group as the page shows it under the program kept: its item,
     * whose icon, drawn from the group file's own bits, is the game's own,
     * as `ExtractIcon` decodes it for the VGA. */
    const files = new Map(
      flattenStack([
        {
          manifest: {
            format: 1,
            id: made.layer.over[0],
            over: [],
            made: { by: 'WinBox' },
            entries: [],
          },
          blobs: new Map(),
        },
        installed.layer,
      ]).files.map((file) => [file.path, file.data])
    );
    const groups = programGroups((path) => files.get(path));

    expect(groups.map((group) => [group.file, group.group?.name])).toEqual([
      ['WINDOWS\\GAMES.GRP', 'Games'],
    ]);

    const [item] = groups[0].group!.items;
    const game = files.get('WINDOWS\\GAMES\\CARRIB.EXE')!;
    const resources = resourcesOf(game);
    const group = resources.filter((each) => each.type === 14)[item.iconIndex];
    const entry = pickIcon(iconEntries(group.data), 32, 16);
    const own = decodeIcon(
      resources.find((each) => each.type === 3 && each.id === entry?.id)!.data,
      DevicePalette.SIXTEEN
    );
    const drawn = iconIndices(item.icon!)!;

    expect([item.name, item.command, item.directory]).toEqual([
      'Caribbean Treasure',
      'c:\\windows\\games\\carrib.exe',
      'c:\\windows\\games',
    ]);
    expect([...drawn.and]).toEqual([...own.and]);
    expect([...drawn.xor]).toEqual([...own.xor]);

    /* And as the launcher lists it (`launch.ts`), as the Rust engine's
     * `install_caribb.rs` has it too: the item run as File Open runs it,
     * the game found in its own directory. */
    const owned = new Set(installed.layer.manifest.entries.map((entry) => entry.path));
    const folders = new Set(
      [...files.keys()].flatMap((path) => {
        const parts = path.split('\\');

        return parts.slice(1).map((_, at) => parts.slice(0, at + 1).join('\\'));
      })
    );
    const launched = launchGroups([
      {
        name: 'Caribbean Treasure',
        read: (path) => files.get(path),
        kind: (path) => (files.has(path) ? 'file' : folders.has(path) ? 'folder' : null),
        own: (path) => owned.has(path),
        exes: [],
      },
    ]);

    expect(
      launched.map((one) => [
        one.name,
        one.winbox,
        one.items.map((each) => [each.name, each.run.program, each.run.directory, each.run.show]),
      ])
    ).toEqual([
      [
        'Games',
        false,
        [['Caribbean Treasure', 'C:\\WINDOWS\\GAMES\\CARRIB.EXE', 'C:\\WINDOWS\\GAMES', 1]],
      ],
    ]);
  }, 900_000);
});
