/**
 * Each kept program's own Program Manager groups (`programGroups`), by the
 * program and its layers: read from the store once, `PROGMAN.INI` and its
 * group files alone, then shown; null while being read, or where they could
 * not be.
 */

import { groupFiles, programFiles, programGroups, PROGMAN_INI } from '../../layers/groups.js';
import { type StackGroup } from '../../layers/groups.js';
import { type KeptProgram, recallBlobs, recallManifests } from '../store.js';

const groupsKept = new Map<string, StackGroup[] | null>();

/** A kept program's groups as read; null until then, the reading begun, `read` told once there are some. */
export function keptGroups(program: KeptProgram, read: () => void) {
  const key = `${program.name}\n${program.layers.join(' ')}`;

  if (!groupsKept.has(key)) {
    groupsKept.set(key, null);
    readGroups(program)
      .then((groups) => {
        groupsKept.set(key, groups);

        if (groups.length) {
          read();
        }
      })
      .catch((error) => console.error(error));
  }

  return groupsKept.get(key) ?? null;
}

/** A kept program's groups, from its layers' manifests and the files they name. */
async function readGroups(program: KeptProgram): Promise<StackGroup[]> {
  const files = programFiles(await recallManifests(program));
  const read = async (paths: string[]) => {
    const hashes = paths.flatMap((path) => files.get(path) ?? []);
    const blobs = await recallBlobs(hashes);

    return new Map(
      paths.flatMap((path) => {
        const data = blobs.get(files.get(path) ?? '');

        return data ? [[path, data] as [string, Uint8Array]] : [];
      })
    );
  };
  const ini = (await read([PROGMAN_INI])).get(PROGMAN_INI);

  if (!ini) {
    return [];
  }

  const found = await read(groupFiles(ini));

  found.set(PROGMAN_INI, ini);
  return programGroups((path) => found.get(path));
}
