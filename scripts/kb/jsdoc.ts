/**
 * The signature and summary of an implemented function, read from the JSDoc
 * comment above it -- the "Signature" and "Summary" parts of a page in
 * `KNOWLEDGE_BASE_SPEC.md`. Each implementation in `src/win16/<module>/`
 * carries one: a description, `@param {Type} name - text` for each argument
 * and `@return {Type} text`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Parameter {
  type: string;
  name: string;
  text: string;
}

export interface Signature {
  description: string;
  parameters: Parameter[];
  returns: { type: string; text: string } | null;
}

/** `{@link Gdi.GetTextExtent GetTextExtent}` and `{@link Foo}` as code text. */
const unlink = (text: string) =>
  text.replace(
    /\{@link\s+([^\s}]+)(?:\s+([^}]+))?\}/g,
    (_, target: string, label?: string) => `\`${label ?? target.split('.').pop()}\``
  );

export function readSignature(root: string, file: string | null, name: string): Signature | null {
  if (!file || !existsSync(join(root, file))) {
    return null;
  }

  const source = readFileSync(join(root, file), 'utf8');
  const declaration = source.search(new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`));

  if (declaration === -1) {
    return null;
  }

  const open = source.lastIndexOf('/**', declaration);
  const close = source.lastIndexOf('*/', declaration);

  if (open === -1 || close < open || source.slice(close + 2, declaration).trim() !== '') {
    return null;
  }

  const lines = source
    .slice(open + 3, close)
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, ''));

  const description: string[] = [];
  const tags: string[] = [];

  for (const line of lines) {
    if (/^@\w/.test(line.trim())) {
      tags.push(line.trim());
    } else if (tags.length) {
      tags[tags.length - 1] += ` ${line.trim()}`;
    } else {
      description.push(line);
    }
  }

  const parameters: Parameter[] = [];
  let returns: Signature['returns'] = null;

  for (const tag of tags) {
    const parameter = tag.match(/^@param\s+\{([^}]+)\}\s+(\w+)\s*-?\s*(.*)$/);

    if (parameter) {
      parameters.push({
        type: parameter[1],
        name: parameter[2],
        text: unlink(parameter[3].replace(/\s+/g, ' ').trim()),
      });
      continue;
    }

    const result = tag.match(/^@returns?\s+\{([^}]+)\}\s*(.*)$/);

    if (result) {
      returns = { type: result[1], text: unlink(result[2].replace(/\s+/g, ' ').trim()) };
    }
  }

  /* The description stops where "See also" begins: those are cross-references
   * into the SDK's own structure, not part of what the function does. */
  const text = description.join('\n');
  const cut = text.search(/\*\*See also\*\*/);

  return {
    description: unlink((cut === -1 ? text : text.slice(0, cut)).trim()),
    parameters,
    returns,
  };
}
