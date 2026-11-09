/**
 * Where the Rust engine answers each export, and what its doc comment says:
 * the "Implementation" link and the summary of a function's page.
 *
 * `call::implementation` (`crates/winbox-win16/src/call.rs`) sends a call by
 * its module's name to that module's dispatch -- `kernel::implementation`,
 * `gdi::implementation` and the rest -- each a `match` on the export's name
 * whose arms name the function that answers it:
 *
 *     "GlobalAlloc" => Implementation::Sync(memory::global_alloc),
 *     "LineTo" => line_to_call,
 *     "WEP" => Implementation::Sync(|system, args| { ... }),
 *
 * and some of whose arms, or whose fall-through, hand the name on to another
 * dispatch (`.or_else(|| crate::drivers::implementation(name))`). This scan
 * follows that from `call.rs`'s arms, module by module, without compiling
 * anything: each export's arm, the file and line of the function it names,
 * and that function's `///` comment. Where an arm's function cannot be
 * found -- a name a macro makes, a path the scan cannot follow -- it says so
 * rather than guess.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const CRATE = join('crates', 'winbox-win16', 'src');

/** One export's arm and the function it names. */
export interface RustArm {
  /** The module's name, as `call::implementation` matches it. */
  module: string;

  /** The export's name, as the arm spells it. */
  name: string;

  /** The file and line of the arm, from the repository's root. */
  armFile: string;
  armLine: number;

  /** The function the arm names, as written there: `memory::global_alloc`;
   * `null` where the arm is a closure of its own. */
  path: string | null;

  /** Where that function is defined, and on what line; for a closure of its
   * own, the arm itself. `null` where it was not found. */
  file: string | null;
  line: number | null;

  /** The function's `///` comment, `null` for none. */
  doc: string | null;

  /** Its first paragraph: the summary. */
  summary: string | null;

  /** Other arms for the same name in the module's dispatches, which a call
   * does not reach first: file and line. */
  alsoIn: string[];

  /**
   * Where the arm a call reaches first is a wrapper ahead of one other arm
   * -- a printer's wrapper (`printer_output.rs` and the rest) that hands any
   * other device context on to GDI's own arm, MCISEQ's `DriverProc` that
   * hands what the sequencer does not answer on to `mci_drivers.rs` -- that
   * other arm's function, which answers a plain call: its path, file, line
   * and doc comment. `null` where the arm has no other, or more than one.
   */
  plain: {
    path: string | null;
    file: string | null;
    line: number | null;
    doc: string | null;
  } | null;

  /** The summary a function's page shows: the first paragraph of `plain`'s
   * doc comment where there is a `plain`, else of the arm's own; `null`
   * where that is only the function's name and where it is (`bare`). */
  shown: string | null;
}

/** A source file, with its comments and strings blanked for scanning. */
interface Source {
  file: string;
  /** The module path it is: `["gdi", "text"]` for `src/gdi/text.rs`. */
  module: string[];
  text: string;
  /** The text with comments and string literals' contents blanked, the
   * same length, so braces and parentheses can be counted. */
  code: string;
}

/** Blanks comments and string contents, keeping every offset. */
function blank(text: string) {
  const out = text.split('');
  let i = 0;

  const fill = (from: number, to: number) => {
    for (let k = from; k < to; k++) {
      if (out[k] !== '\n') {
        out[k] = ' ';
      }
    }
  };

  while (i < text.length) {
    const two = text.slice(i, i + 2);

    if (two === '//') {
      const end = text.indexOf('\n', i);
      fill(i, end === -1 ? text.length : end);
      i = end === -1 ? text.length : end;
    } else if (two === '/*') {
      let depth = 1;
      let k = i + 2;

      while (k < text.length && depth) {
        if (text.startsWith('/*', k)) {
          depth++;
          k += 2;
        } else if (text.startsWith('*/', k)) {
          depth--;
          k += 2;
        } else {
          k++;
        }
      }

      fill(i, k);
      i = k;
    } else if (text[i] === '"' || (text[i] === 'b' && text[i + 1] === '"')) {
      const start = text[i] === 'b' ? i + 1 : i;
      let k = start + 1;

      while (k < text.length && text[k] !== '"') {
        k += text[k] === '\\' ? 2 : 1;
      }

      fill(start + 1, k);
      i = k + 1;
    } else if (text[i] === 'r' && /^r#*"/.test(text.slice(i, i + 4)) && !/\w/.test(text[i - 1])) {
      const hashes = text.slice(i + 1).match(/^#*/)![0];
      const close = '"' + hashes;
      const start = i + 1 + hashes.length;
      const end = text.indexOf(close, start + 1);
      fill(start + 1, end);
      i = end + close.length;
    } else if (text[i] === "'" && /^'(?:\\.|[^\\'])'/.test(text.slice(i, i + 4))) {
      const end = text.indexOf("'", i + 2);
      fill(i + 1, end);
      i = end + 1;
    } else {
      i++;
    }
  }

  return out.join('');
}

function readSources(root: string): Source[] {
  const sources: Source[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith('.rs')) {
        const text = readFileSync(join(root, path), 'utf8');
        const parts = relative(CRATE, path).replace(/\.rs$/, '').split('/');

        if (parts.at(-1) === 'mod' || parts.at(-1) === 'lib') {
          parts.pop();
        }

        sources.push({ file: path, module: parts, text, code: blank(text) });
      }
    }
  };

  walk(CRATE);
  return sources;
}

/** The offset of the bracket closing the one at `open`, in blanked code. */
function closing(code: string, open: number) {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const stack: string[] = [];

  for (let i = open; i < code.length; i++) {
    const c = code[i];

    if (pairs[c]) {
      stack.push(pairs[c]);
    } else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== c) {
        return -1;
      }

      if (!stack.length) {
        return i;
      }
    }
  }

  return -1;
}

const lineOf = (text: string, at: number) => text.slice(0, at).split('\n').length;

/** A function that answers by an export's name: `-> Option<Implementation>`. */
interface Dispatch {
  source: Source;
  name: string;
  body: [number, number];
}

function dispatches(sources: Source[]): Dispatch[] {
  const found: Dispatch[] = [];

  for (const source of sources) {
    const pattern =
      /fn\s+(\w+)\s*\(\s*name\s*:\s*&str\s*\)\s*->\s*Option<(?:crate::call::)?Implementation>\s*\{/g;

    for (const match of source.code.matchAll(pattern)) {
      const open = match.index! + match[0].length - 1;
      found.push({ source, name: match[1], body: [open, closing(source.code, open)] });
    }
  }

  return found;
}

/** The module path a path's leading segments name, seen from a file. */
function resolveModule(from: Source, segments: string[], sources: Source[]): string[] | null {
  if (!segments.length) {
    return from.module;
  }

  const [first, ...rest] = segments;

  if (first === 'crate') {
    return rest;
  }

  if (first === 'self') {
    return [...from.module, ...rest];
  }

  if (first === 'super') {
    return resolveModule(
      { ...from, module: from.module.slice(0, -1) },
      rest[0] === 'super' ? rest : rest,
      sources
    );
  }

  /* Imported by a `use`: `use crate::memory;`, `use super::{dc, objects};`. */
  const imported = uses(from).get(first);

  if (imported) {
    return resolveModule(from, [...imported, ...rest], sources);
  }

  /* A child module of the file's own. */
  const child = [...from.module, first, ...rest];

  if (sources.some((source) => same(source.module, child))) {
    return child;
  }

  /* A module of the crate's root, as a path from `lib.rs` names it. */
  if (sources.some((source) => same(source.module, segments))) {
    return segments;
  }

  return null;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

const useCache = new Map<string, Map<string, string[]>>();

/** What a file's `use` declarations bring into scope, by the name used. */
function uses(source: Source) {
  const cached = useCache.get(source.file);

  if (cached) {
    return cached;
  }

  const names = new Map<string, string[]>();
  const add = (prefix: string[], tree: string) => {
    tree = tree.trim();

    const group = tree.match(/^([\w:]*?)(?:::)?\{([\s\S]*)\}$/);

    if (group) {
      const base = [...prefix, ...group[1].split('::').filter(Boolean)];
      let depth = 0;
      let start = 0;
      const inner = group[2];

      for (let i = 0; i <= inner.length; i++) {
        const c = inner[i];

        if (c === '{') depth++;
        if (c === '}') depth--;

        if ((c === ',' && !depth) || i === inner.length) {
          const part = inner.slice(start, i).trim();

          if (part) {
            add(base, part);
          }

          start = i + 1;
        }
      }

      return;
    }

    const alias = tree.match(/^([\w:]+)\s+as\s+(\w+)$/);
    const path = [...prefix, ...(alias ? alias[1] : tree).split('::')];
    const name = alias ? alias[2] : path.at(-1)!;

    if (name === 'self') {
      path.pop();
      names.set(path.at(-1)!, path);
    } else if (name !== '*') {
      names.set(name, path);
    }
  };

  for (const match of source.code.matchAll(
    /(?:^|\n)\s*(?:pub(?:\([\w:]+\))?\s+)?use\s+([^;]+);/g
  )) {
    add([], match[1].replace(/\s+/g, ' '));
  }

  useCache.set(source.file, names);
  return names;
}

/** Where a function a path names is defined: its file and offset. */
function define(
  from: Source,
  path: string,
  sources: Source[]
): { source: Source; at: number } | null {
  const segments = path.split('::');
  const name = segments.pop()!;
  let module = resolveModule(from, segments, sources);

  /* A bare name a `use` brought in: `use crate::kernel_calls::lcreat;`. */
  if (!segments.length) {
    const imported = uses(from).get(name);

    if (imported) {
      return define(from, imported.join('::'), sources);
    }
  }

  if (!module) {
    return null;
  }

  for (let hops = 0; hops < 4 && module; hops++) {
    const target = sources.find((source) => same(source.module, module!));

    if (!target) {
      return null;
    }

    const definition = new RegExp(
      `(?:^|\\n)[ \\t]*(?:pub(?:\\([\\w:]+\\))?\\s+)?(?:async\\s+)?fn\\s+${name}\\b`
    ).exec(target.code);

    if (definition) {
      return { source: target, at: definition.index + definition[0].indexOf('fn') };
    }

    /* Made by a macro of the file's own: `export!(name, ...)`. */
    const made = new RegExp(`(?:^|\\n)[ \\t]*\\w+!\\s*\\(\\s*${name}\\s*,`).exec(target.code);

    if (made) {
      return { source: target, at: made.index + made[0].search(/\w+!/) };
    }

    /* Re-exported: `pub use inner::name;` or `pub(crate) use x::{name}`. */
    const imported = uses(target).get(name);

    if (!imported) {
      return null;
    }

    const next = resolveModule(target, imported.slice(0, -1), sources);
    module = next;

    if (imported.at(-1) !== name) {
      return define(target, imported.join('::'), sources);
    }
  }

  return null;
}

/** The `///` comment above an offset, attributes and `#[...]` skipped. */
function docAbove(source: Source, at: number): string | null {
  const lines = source.text.slice(0, at).split('\n');
  lines.pop();

  const doc: string[] = [];

  while (lines.length) {
    const line = lines.pop()!.trim();

    if (line.startsWith('///')) {
      doc.unshift(line.replace(/^\/\/\/ ?/, ''));
    } else if (
      line.startsWith('#[') ||
      line.startsWith('#![') ||
      (doc.length === 0 && line === '')
    ) {
      if (line === '') {
        break;
      }
    } else {
      break;
    }
  }

  return doc.length ? doc.join('\n').trim() : null;
}

/** The first paragraph of a doc comment, on one line. */
const firstParagraph = (doc: string) =>
  doc
    .split(/\n\s*\n/)[0]
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Whether a summary is only the function's name and where it is,
 * `` `mmioOpen` (`2a5`). ``: it says nothing of what the function does, so
 * no summary is shown for it.
 */
const bare = (summary: string, name: string) =>
  new RegExp(`^\`?${name}\`?\\s*\\([^()]*\\)\\.?$`, 'i').test(summary);

/** The arms of one dispatch: each export name and the expression it answers with. */
function armsOf(dispatch: Dispatch) {
  const { code, text } = dispatch.source;
  const [from, to] = dispatch.body;
  const arms: { names: string[]; at: number; expression: string; written: string; end: number }[] =
    [];
  const pattern = /((?:"[^"\n]*"\s*\|\s*)*"[^"\n]*")\s*=>\s*/g;
  pattern.lastIndex = from;

  for (let match = pattern.exec(code); match && match.index < to; match = pattern.exec(code)) {
    const names = [
      ...text.slice(match.index, match.index + match[1].length).matchAll(/"([^"]*)"/g),
    ].map((name) => name[1]);
    const start = match.index + match[0].length;
    let end = start;
    let depth = 0;

    /* A closure's parameters hold commas of their own. */
    const closure = /^(?:move\s+)?\|/.exec(code.slice(start));

    if (closure) {
      end = code.indexOf('|', start + closure[0].length) + 1;
    }

    for (; end < to; end++) {
      const c = code[end];

      if (c === '(' || c === '[' || c === '{') depth++;
      if (c === ')' || c === ']' || c === '}') {
        if (!depth) break;
        depth--;
        if (
          !depth &&
          c === '}' &&
          code
            .slice(start, end + 1)
            .trim()
            .startsWith('{')
        ) {
          end++;
          break;
        }
      }
      if (c === ',' && !depth) break;
    }

    arms.push({
      names,
      at: match.index,
      expression: code.slice(start, end).trim(),
      written: text.slice(start, end).trim(),
      end,
    });

    /* Not into the arm's own body: a `match` there is not the dispatch's. */
    pattern.lastIndex = Math.max(end, start);
  }

  /* `if name == "RealizePalette" { return Some(Implementation::Async(f)); }` */
  for (const match of code
    .slice(from, to)
    .matchAll(/name\s*==\s*"([^"]*)"\s*\{\s*return\s+([^;]+);/g)) {
    const at = from + match.index!;
    const written = text.slice(at, at + match[0].length);
    arms.push({
      names: [written.match(/"([^"]*)"/)![1]],
      at,
      expression: match[2],
      written: written.slice(written.indexOf(match[2].slice(0, 6))),
      end: at + match[0].length,
    });
  }

  return arms;
}

/** What an arm's expression names: a function's path, a closure of its own,
 * or another dispatch. */
function answerOf(
  expression: string,
  written: string
): { path: string | null } | { delegate: true } | { alias: string; via: string } | null {
  const alias = written.match(/^return\s+([\w:]+)\s*\(\s*"([^"]+)"\s*\)$/);

  if (alias) {
    return { alias: alias[2], via: alias[1] };
  }

  /* A name another's stands for, which the dispatch hands on after its
   * `match`: `"DrvOpen" => Some("OpenDriver")`, then
   * `return crate::drivers::implementation(user)`. */
  const named = written.match(/^Some\(\s*"([^"]+)"\s*\)$/);

  if (named) {
    return { alias: named[1], via: '' };
  }

  let e = expression.trim();

  if (/^return\b/.test(e) && /implementation\s*\(\s*name\s*\)/.test(e)) {
    return { delegate: true };
  }

  for (;;) {
    const before = e;

    e = e.replace(/^return\s+/, '').trim();

    const wrapped = e.match(
      /^(?:Some|(?:crate::call::)?Implementation::(?:Sync|Async)|Sync|Async)\s*\(([\s\S]*)\)$/
    );

    if (wrapped) {
      e = wrapped[1].trim();
    }

    const block = e.match(/^\{([\s\S]*)\}$/);

    if (block && !/;\s*\S/.test(block[1].replace(/;\s*$/, ''))) {
      e = block[1].trim().replace(/;$/, '').trim();
    }

    if (e === before) {
      break;
    }
  }

  if (/^[\w:]+$/.test(e) && /[a-z_]/.test(e) && !/^(?:None|_)$/.test(e)) {
    return { path: e };
  }

  /* A closure that calls one function: `|system, args| helper(system, args, KIND)`. */
  const closure = e.match(/^(?:move\s+)?\|[^|]*\|\s*([\s\S]*)$/);

  if (closure) {
    const body = closure[1].trim();
    const call = body.match(/^(?:Ok\()?([\w:]+)\s*\(/);

    /* A function's name, not a value's constructor (`Answer::Dword`). */
    if (
      call &&
      /^[a-z_][a-z0-9_]*$/.test(call[1].split('::').pop()!) &&
      closing(body, body.indexOf('(', call.index! + call[0].length - 1)) ===
        body.length - (body.startsWith('Ok(') ? 2 : 1)
    ) {
      return { path: call[1] };
    }

    return { path: null };
  }

  return null;
}

/** One step of a dispatch, in the order its code takes them: an arm, or a
 * hand-on to another dispatch outside any arm (`.or_else(|| x(name))`,
 * `_ => return x(name)`, `if let Some(..) = x(name)`). */
type Step =
  | { kind: 'arm'; names: string[]; at: number; answer: Answer; source: Source }
  | { kind: 'delegate'; at: number; to: Dispatch };

type Answer =
  | { path: string | null }
  | { delegate: Dispatch[] }
  | { alias: string; via: Dispatch | undefined }
  | { made: { source: Source; at: number } };

/** Every module's exports, as `call::implementation` sends them, and where
 * each is answered. */
export function scanRust(root: string): Map<string, RustArm> {
  const sources = readSources(root);
  const all = dispatches(sources);
  const call = sources.find((source) => source.file === join(CRATE, 'call.rs'))!;

  /* A dispatch a path names, seen from a file: by module path, else in an
   * inline `mod` of the file's own (`method_names::named`). */
  const dispatchAt = (from: Source, path: string): Dispatch | undefined => {
    const segments = path.split('::');
    const name = segments.pop()!;
    const module = resolveModule(from, segments, sources);
    const found = all.find(
      (dispatch) => dispatch.name === name && module && same(dispatch.source.module, module)
    );

    if (found || segments.length !== 1) {
      return found;
    }

    const inline = new RegExp(`\\bmod\\s+${segments[0]}\\s*\\{`).exec(from.code);

    if (!inline) {
      return undefined;
    }

    const open = inline.index + inline[0].length - 1;
    const close = closing(from.code, open);

    return all.find(
      (dispatch) =>
        dispatch.source === from &&
        dispatch.name === name &&
        dispatch.body[0] > open &&
        dispatch.body[1] < close
    );
  };

  const delegatePattern = /([\w:]*?)(\w*implementation|\w*named)\s*\(\s*name\s*\)/g;
  const delegatesIn = (from: Source, text: string) =>
    [...text.matchAll(delegatePattern)]
      .map((match) => ({ at: match.index!, to: dispatchAt(from, `${match[1]}${match[2]}`) }))
      .filter((found): found is { at: number; to: Dispatch } => !!found.to);

  /* What a module's name sends to, from `call::implementation`'s arms. */
  const top = /pub\(crate\) fn implementation\(module: &str, name: &str\)[^{]*\{/.exec(call.code)!;
  const topOpen = top.index + top[0].length - 1;
  const topBody = call.text.slice(topOpen, closing(call.code, topOpen));
  const roots = new Map<string, Dispatch[]>();
  const heads = [...topBody.matchAll(/\n\s*("[A-Z0-9]+"|[\w:]+::NAME)\s*=>/g)];

  for (const [index, head] of heads.entries()) {
    const sent = topBody.slice(head.index! + head[0].length, heads[index + 1]?.index);
    let module = head[1];

    if (!module.startsWith('"')) {
      const owner = sources.find((source) => same(source.module, module.split('::').slice(1, -1)));
      module = `"${owner?.text.match(/pub(?:\(crate\))?\s+const\s+NAME:\s*&str\s*=\s*"([^"]+)"/)?.[1]}"`;
    }

    roots.set(
      module.slice(1, -1),
      delegatesIn(call, sent).map((found) => found.to)
    );
  }

  /* The dispatch a name another stands for is handed to, after the arms
   * that name it: the first `return path(other)` of the dispatch. */
  const handedOn = (source: Source, from: number, to: number) => {
    const call = /return\s+([\w:]+)\s*\(\s*(?!name\b)\w+\s*\)/.exec(source.code.slice(from, to));

    return call ? dispatchAt(source, call[1]) : undefined;
  };

  /* Each dispatch's steps. */
  const steps = new Map<Dispatch, Step[]>();
  const stepsOf = (dispatch: Dispatch): Step[] => {
    const known = steps.get(dispatch);

    if (known) {
      return known;
    }

    const { source } = dispatch;
    const found: Step[] = [];

    for (const arm of armsOf(dispatch)) {
      const answer = answerOf(arm.expression, arm.written);

      if (!answer) {
        continue;
      }

      if ('delegate' in answer) {
        found.push({
          kind: 'arm',
          names: arm.names,
          at: arm.at,
          source,
          answer: { delegate: delegatesIn(source, arm.expression).map((d) => d.to) },
        });
      } else if ('alias' in answer) {
        found.push({
          kind: 'arm',
          names: arm.names,
          at: arm.at,
          source,
          answer: {
            alias: answer.alias,
            via: answer.via
              ? dispatchAt(source, answer.via)
              : handedOn(source, arm.end, dispatch.body[1]),
          },
        });
      } else {
        found.push({ kind: 'arm', names: arm.names, at: arm.at, source, answer });
      }
    }

    /* A dispatch a macro makes for each name its invocations give:
     * `stringify!($name) => Implementation::Async($name)`. */
    const body = source.code.slice(...dispatch.body);

    if (body.includes('stringify!($name)')) {
      const macro = [
        ...source.code.slice(0, dispatch.body[0]).matchAll(/macro_rules!\s*(\w+)/g),
      ].at(-1)?.[1];

      for (const invocation of source.code.matchAll(new RegExp(`\\b${macro}!\\s*\\{`, 'g'))) {
        const open = invocation.index! + invocation[0].length - 1;
        const list = source.code.slice(open, closing(source.code, open));

        for (const entry of list.matchAll(/\d+\s*=>\s*(\w+)/g)) {
          const at = open + entry.index! + entry[0].lastIndexOf(entry[1]);
          found.push({
            kind: 'arm',
            names: [entry[1]],
            at,
            source,
            answer: { made: { source, at } },
          });
        }
      }
    }

    /* Hand-ons outside every arm. */
    for (const delegate of delegatesIn(source, body)) {
      const at = dispatch.body[0] + delegate.at;
      const inArm = armsOf(dispatch).some((arm) => at >= arm.at && at < arm.end);

      if (!inArm && delegate.to !== dispatch) {
        found.push({ kind: 'delegate', at, to: delegate.to });
      }
    }

    found.sort((a, b) => a.at - b.at);
    steps.set(dispatch, found);
    return found;
  };

  /* Where a dispatch answers a name: its first arm for it, or the first
   * hand-on, in order, that answers it. */
  const resolve = (
    dispatch: Dispatch,
    name: string,
    seen: Set<Dispatch>
  ): { step: Extract<Step, { kind: 'arm' }>; name: string } | null => {
    if (seen.has(dispatch)) {
      return null;
    }

    seen.add(dispatch);

    for (const step of stepsOf(dispatch)) {
      if (step.kind === 'delegate') {
        const found = resolve(step.to, name, seen);

        if (found) {
          return found;
        }

        continue;
      }

      if (!step.names.includes(name)) {
        continue;
      }

      const answer = step.answer;

      if ('delegate' in answer) {
        for (const to of answer.delegate) {
          const found = resolve(to, name, new Set(seen));

          if (found) {
            return found;
          }
        }

        return null;
      }

      if ('alias' in answer) {
        return answer.via ? resolve(answer.via, answer.alias, new Set()) : null;
      }

      return { step, name };
    }

    return null;
  };

  /* An arm's function: its path, where it is defined, and its doc comment. */
  const describe = (step: Extract<Step, { kind: 'arm' }>, name: string) => {
    const answer = step.answer as
      { path: string | null } | { made: { source: Source; at: number } };
    const armLine = lineOf(step.source.text, step.at);
    const definition =
      'made' in answer
        ? answer.made
        : answer.path
          ? define(step.source, answer.path, sources)
          : null;
    const own = 'path' in answer && answer.path === null;

    return {
      armLine,
      path: 'made' in answer ? name : answer.path,
      file: own ? step.source.file : (definition?.source.file ?? null),
      line: own ? armLine : definition ? lineOf(definition.source.text, definition.at) : null,
      doc: definition && !('made' in answer) ? docAbove(definition.source, definition.at) : null,
    };
  };

  const arms = new Map<string, RustArm>();

  for (const [module, starts] of roots) {
    /* Every name an arm reachable from the module's dispatch gives. */
    const names = new Set<string>();
    const others = new Map<string, Extract<Step, { kind: 'arm' }>[]>();
    const reached = new Set<Dispatch>();
    const queue = [...starts];

    while (queue.length) {
      const dispatch = queue.shift()!;

      if (reached.has(dispatch)) continue;
      reached.add(dispatch);

      for (const step of stepsOf(dispatch)) {
        if (step.kind === 'delegate') {
          queue.push(step.to);
        } else {
          step.names.forEach((name) => {
            names.add(name);

            if (!('delegate' in step.answer) && !('alias' in step.answer)) {
              others.set(name, [...(others.get(name) ?? []), step]);
            }
          });

          if ('delegate' in step.answer) {
            queue.push(...step.answer.delegate);
          }
        }
      }
    }

    for (const name of names) {
      let found: ReturnType<typeof resolve> = null;

      for (const start of starts) {
        found = resolve(start, name, new Set());

        if (found) break;
      }

      if (!found) {
        continue;
      }

      const { step } = found;
      const first = describe(step, name);
      const rest = (others.get(name) ?? []).filter((other) => other !== step);
      const plain = rest.length === 1 ? describe(rest[0], name) : null;
      const shown = plain ? plain.doc : first.doc;
      const summaryShown = shown ? firstParagraph(shown) : null;

      arms.set(`${module}.${name}`, {
        module,
        name,
        armFile: step.source.file,
        armLine: first.armLine,
        path: first.path,
        file: first.file,
        line: first.line,
        doc: first.doc,
        summary: first.doc ? firstParagraph(first.doc) : null,
        alsoIn: rest.map((other) => `${other.source.file}:${lineOf(other.source.text, other.at)}`),
        plain: plain && { path: plain.path, file: plain.file, line: plain.line, doc: plain.doc },
        shown: summaryShown && !bare(summaryShown, name) ? summaryShown : null,
      });
    }
  }

  return arms;
}

/* Run as a program: every arm, one line each, for a look. */
if (process.argv[1]?.endsWith('rustdoc.js') && existsSync(CRATE)) {
  for (const arm of scanRust('.').values()) {
    console.log(
      `${arm.module}.${arm.name}\t${arm.path ?? '(closure)'}\t${arm.file ?? 'NOT FOUND'}:${arm.line ?? ''}\t${arm.summary ? 'doc' : '-'}	${arm.alsoIn.join(' ')}`
    );
  }
}
