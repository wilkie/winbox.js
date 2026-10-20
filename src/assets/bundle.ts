/**
 * An asset bundle, read (`kb/topics/asset-bundle.md`): its pool of files, the
 * base of C: it composes for a display (`compose.ts`), and its modules --
 * `USER.EXE`, `SHELL.DLL` and the display drivers, their code taken out --
 * the store the kept modules' resources are read from where C: has no file of
 * theirs: `options.assets.module(name)`, as `Win16` takes it.
 *
 * The Rust engine's twin is `crates/winbox-win16/src/assets.rs`'s `Assets`.
 */

import { readZip } from '../zip.js';
import { composeBase, type Composed, type PoolFile } from './compose.js';
import { FORMAT, MANIFEST, type Manifest } from './make.js';

/** What `Win16` takes as `options.assets`: the bundle's modules, by name. */
export interface ModuleStore {
  /** A module's file by its name, `VGA.DRV`; none where the store has none. */
  module(name: string): Uint8Array | undefined;
}

export class Assets implements ModuleStore {
  readonly pool = new Map<string, PoolFile>();
  readonly modules = new Map<string, Uint8Array>();

  constructor(readonly manifest: Manifest) {}

  /** The bundle's id: the sha256 of its files' sha256s. */
  get id() {
    return this.manifest.id;
  }

  /** The display modes it serves. */
  get displays() {
    return this.manifest.displays;
  }

  /**
   * A bundle from its files by their paths in it, the manifest among them.
   * Refused: no manifest, a format this engine does not know, a file the
   * manifest names missing or of another size.
   */
  static fromFiles(read: (path: string) => Uint8Array | undefined): Assets {
    const text = read(MANIFEST);

    if (!text) {
      throw new Error(`no ${MANIFEST}: not an asset bundle`);
    }

    const manifest: Manifest = JSON.parse(new TextDecoder().decode(text));

    if (manifest.format !== FORMAT) {
      throw new Error(`an asset bundle of format ${manifest.format}: this WinBox reads ${FORMAT}`);
    }

    const assets = new Assets(manifest);

    for (const file of manifest.files) {
      const data = read(file.path);

      if (!data) {
        throw new Error(`${file.path} is missing`);
      }

      if (data.length !== file.size) {
        throw new Error(`${file.path} is not the size the manifest says`);
      }

      if (file.path.startsWith('pool/')) {
        assets.pool.set(file.path.slice(5).toUpperCase(), {
          data,
          date: file.date,
          time: file.time,
        });
      } else if (file.path.startsWith('modules/')) {
        assets.modules.set(file.path.slice(8).toUpperCase(), data);
      }
    }

    return assets;
  }

  /** A bundle from `winbox-assets.zip`'s bytes. */
  static async fromZip(bytes: Uint8Array): Promise<Assets> {
    const entries = new Map((await readZip(bytes)).map((entry) => [entry.path, entry.data]));

    return Assets.fromFiles((path) => entries.get(path));
  }

  module(name: string) {
    return this.modules.get(name.toUpperCase());
  }

  /** The base of C: for a display, from the bundle's pool. */
  compose(display: string): Composed {
    return composeBase((name) => this.pool.get(name.toUpperCase()), display);
  }
}
