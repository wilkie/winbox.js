/**
 * The "Signature" part of a function's page (`KNOWLEDGE_BASE_SPEC.md`): the
 * return type, and each parameter's type and name.
 *
 * They were read from JSDoc (`@param {Type} name`, `@returns {Type}`) and
 * frozen on 2026-11-08 into `kb/data/signatures.json`, which is where they
 * are kept: the Rust engine's functions read their arguments in their bodies
 * and carry no such tags. A function's summary is its Rust doc comment
 * (`rustdoc.ts`), or, where the Rust function has none, the description
 * frozen beside its signature.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Signature {
  /** The return type: `void` where the function answers nothing. */
  returns: string;

  parameters: { type: string; name: string }[];

  /** The frozen description, where the Rust function has no doc
   * comment of its own. */
  summary?: string;
}

export const SIGNATURES_FILE = join('kb', 'data', 'signatures.json');

/** Every frozen signature, by `MODULE.Name`. */
export function readSignatures(root = '.'): Map<string, Signature> {
  const { functions } = JSON.parse(readFileSync(join(root, SIGNATURES_FILE), 'utf8')) as {
    functions: Record<string, Signature>;
  };

  return new Map(Object.entries(functions));
}
