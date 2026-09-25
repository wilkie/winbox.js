'use strict';

/**
 * A resource of a program's own, by its type and by the number or the name a
 * program names it with.
 *
 * A name comes as a string; a number as the number, or as a string `#12` the
 * way a resource script writes one. A named resource keeps its name as its
 * `id` in some executables and as `name` in others, so both are looked at.
 */
export function findResource(executable: any, type: number, key: any) {
  let id: number | null = null;
  let name: string | null = null;

  if (key instanceof String || typeof key === 'string') {
    const text = String(key);

    if (/^#\d+$/.test(text)) {
      id = Number(text.slice(1));
    } else {
      name = text.toUpperCase();
    }
  } else {
    id = key & 0xffff;
  }

  for (const resourceType of executable?.resources ?? []) {
    if (resourceType.id != type) {
      continue;
    }

    for (const resource of resourceType.entries) {
      if (id !== null && resource.id === id) {
        return resource;
      }

      if (
        name !== null &&
        (String(resource.name ?? '').toUpperCase() === name ||
          String(resource.id).toUpperCase() === name)
      ) {
        return resource;
      }
    }
  }

  return null;
}

/** A resource's bytes, or null when the program has no such resource. */
export async function resourceBytes(executable: any, type: number, key: any) {
  const resource = findResource(executable, type, key);

  return resource ? new Uint8Array(await executable.readResource(resource)) : null;
}
