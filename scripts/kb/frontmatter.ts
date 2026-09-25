/**
 * The front matter every knowledge base page starts with, and the one reader
 * of it.
 *
 * It is a strict subset of YAML: `key: value`, `key: [a, b]`, and one level of
 * nesting for the `versions` map. Nothing else is accepted, and anything the
 * schema does not name is an error rather than something ignored, so a typo in
 * a field cannot quietly drop a claim from the site. See `kb/README.md`.
 */

export const KINDS = [
  'function',
  'structure',
  'message',
  'constants',
  'format',
  'topic',
  'guide',
] as const;
export const VERSIONS = ['3.0', '3.1', '3.11'] as const;
export const STATUSES = ['exact', 'partial', 'stub', 'unrecorded'] as const;

export type Kind = (typeof KINDS)[number];
export type Version = (typeof VERSIONS)[number];
export type Status = (typeof STATUSES)[number];

export interface FrontMatter {
  kind: Kind;
  name: string;
  module?: string;
  ordinal?: number;
  summary?: string;
  versions: Partial<Record<Version, Status>>;
  probes: string[];
  source?: string;
  topics: string[];
}

const FIELDS = [
  'kind',
  'name',
  'module',
  'ordinal',
  'summary',
  'versions',
  'probes',
  'source',
  'topics',
];

/** A value as written: a quoted string, a number, or a bare word. */
function scalar(text: string): string | number {
  const trimmed = text.trim();

  if (/^"(?:[^"\\]|\\.)*"$/.test(trimmed)) {
    return JSON.parse(trimmed);
  }

  /* Single quotes, as Prettier writes them: a doubled quote is one quote. */
  if (/^'(?:[^']|'')*'$/.test(trimmed)) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }

  if (/^-?\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  return trimmed;
}

/**
 * Splits a page into its front matter and its body, and reads the front
 * matter. Throws with the file and line on anything outside the subset.
 */
export function parsePage(file: string, text: string): { front: FrontMatter; body: string } {
  const lines = text.split(/\r?\n/);

  if (lines[0] !== '---') {
    throw new Error(`${file}: a page starts with a front matter block opened by ---`);
  }

  const end = lines.indexOf('---', 1);

  if (end === -1) {
    throw new Error(`${file}: the front matter is never closed by ---`);
  }

  const raw: Record<string, any> = {};
  let nested: string | null = null;

  for (let index = 1; index < end; index++) {
    const line = lines[index];
    const where = `${file}:${index + 1}`;

    if (line.trim() === '' || line.trim().startsWith('#')) {
      continue;
    }

    const child = line.match(/^ {2}("[\w.]+"|'[\w.]+'|[\w.]+):\s*(.+)$/);

    if (child) {
      if (!nested) {
        throw new Error(`${where}: an indented line belongs under a key with no value of its own`);
      }

      raw[nested][String(scalar(child[1]))] = scalar(child[2]);
      continue;
    }

    const field = line.match(/^(\w+):\s*(.*)$/);

    if (!field) {
      throw new Error(`${where}: not a front matter line: ${line}`);
    }

    const [, key, value] = field;

    if (!FIELDS.includes(key)) {
      throw new Error(`${where}: no field "${key}" in the schema; see kb/README.md`);
    }

    /* A list too long for one line is the way Prettier wraps it: the key on
     * its own, then the brackets and one item a line, indented. */
    let list = value;

    if (value === '' && lines[index + 1]?.trim().startsWith('[')) {
      list = '';

      while (index + 1 < end && !list.endsWith(']')) {
        list += lines[++index].trim();
      }
    }

    if (list === '') {
      raw[key] = {};
      nested = key;
    } else if (list.startsWith('[')) {
      if (!list.endsWith(']')) {
        throw new Error(`${where}: a list is not closed with ]`);
      }

      raw[key] = list
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => String(scalar(item)));
      nested = null;
    } else {
      raw[key] = scalar(value);
      nested = null;
    }
  }

  return { front: validate(file, raw), body: lines.slice(end + 1).join('\n') };
}

/** The schema's own rules, apart from anything that needs the export tables. */
function validate(file: string, raw: Record<string, any>): FrontMatter {
  const fail = (message: string) => {
    throw new Error(`${file}: ${message}`);
  };

  if (!KINDS.includes(raw.kind)) {
    fail(`kind must be one of ${KINDS.join(', ')}`);
  }

  if (typeof raw.name !== 'string' || raw.name === '') {
    fail('name is required');
  }

  if (
    ['function', 'structure', 'message', 'constants'].includes(raw.kind) &&
    typeof raw.module !== 'string'
  ) {
    fail(`a ${raw.kind} page names its module`);
  }

  if (raw.kind === 'function' && typeof raw.ordinal !== 'number') {
    fail('a function page gives its ordinal');
  }

  const versions = raw.versions ?? {};

  for (const [version, status] of Object.entries(versions)) {
    if (!VERSIONS.includes(version as Version)) {
      fail(`versions names ${version}; the versions are ${VERSIONS.join(', ')}`);
    }

    if (!STATUSES.includes(status as Status)) {
      fail(`versions.${version} is ${status}; a status is one of ${STATUSES.join(', ')}`);
    }
  }

  for (const list of ['probes', 'topics']) {
    if (raw[list] !== undefined && !Array.isArray(raw[list])) {
      fail(`${list} is a list, [a, b]`);
    }
  }

  return {
    kind: raw.kind,
    name: raw.name,
    module: raw.module,
    ordinal: raw.ordinal,
    summary: raw.summary,
    versions,
    probes: raw.probes ?? [],
    source: raw.source,
    topics: raw.topics ?? [],
  };
}
