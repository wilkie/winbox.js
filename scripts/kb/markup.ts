/**
 * The body of a knowledge base page: Markdown, with two additions the build
 * checks.
 *
 * References, written `[[kind:target]]` or `[[kind:target|text]]`, link to
 * another page of the site and fail the build if there is no such page:
 *
 *   [[fn:GDI.TextOut]]        a function, by module and exported name
 *   [[topic:synthetic-bold]]  a topic page, by its file name in kb/topics/
 *   [[format:fot]]            a file format page, by its file name in kb/formats/
 *   [[guide:contributing]]    a guide, by its file name in kb/guides/
 *   [[probe:smearmod]]        a probe, by its name in oracle/probes/
 *   [[fonts:8u]]              a section of FONTS.md, by its number, at the
 *                             anchor GitHub and GitLab generate for its heading
 *
 * Evidence labels, written `[[measured]]`, `[[read out]]`, `[[documented]]`,
 * `[[inferred]]` or `[[refused]]`, mark how a claim is known -- the evidence
 * model of `KNOWLEDGE_BASE_SPEC.md`.
 *
 * Raw HTML is not accepted: a page's body is text. A ```mermaid fence becomes
 * a diagram.
 */

import MarkdownIt from 'markdown-it';

export const LABELS: Record<string, string> = {
  documented: 'Documented',
  measured: 'Measured',
  'read out': 'Read out',
  inferred: 'Inferred',
  refused: 'Refused',
};

/** One thing a reference can point at: its URL from the site's root, and what to call it. */
export interface Target {
  url: string;
  title: string;
}

/** What references can point at. Functions are keyed `MODULE.NAME`, upper case. */
export interface Targets {
  functions: Map<string, Target>;
  topics: Map<string, Target>;
  formats: Map<string, Target>;
  guides: Map<string, Target>;
  probes: Map<string, Target>;

  /** FONTS.md sections, by number, to their anchors. */
  fonts: Map<string, string>;
}

/** The anchor GitHub and GitLab give a Markdown heading. */
export function headingSlug(heading: string) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/**
 * The sections of FONTS.md that a page may cite, by the number each heading
 * starts with: `8u`, `8b`, `9`.
 */
export function fontsSections(text: string) {
  const sections = new Map<string, string>();

  for (const line of text.split('\n')) {
    const match = line.match(/^#{2,3} (\d+[a-z]?)\. (.*)$/);

    if (match && !sections.has(match[1])) {
      sections.set(match[1], headingSlug(`${match[1]}. ${match[2]}`));
    }
  }

  return sections;
}

export interface RenderContext {
  /** How to get from the page to the site's root: `../../`. */
  up: string;

  /** Where FONTS.md is published, for `[[fonts:…]]`. */
  fontsUrl: string;
  targets: Targets;

  /** The page's own file, for error messages. */
  file: string;

  /** Every reference that did not resolve is added here. */
  errors: string[];

  /** Told the site URL of every page a reference resolved to. */
  linked?: (url: string) => void;
}

export interface Rendered {
  html: string;
  mermaid: boolean;
}

export function render(body: string, context: RenderContext): Rendered {
  const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });
  let mermaid = false;

  markdown.inline.ruler.before('link', 'kb_reference', (state, silent) => {
    const { src, pos } = state;

    if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) {
      return false;
    }

    const end = src.indexOf(']]', pos + 2);

    if (end === -1) {
      return false;
    }

    if (!silent) {
      const inside = src.slice(pos + 2, end);
      const token = state.push('kb_reference', '', 0);
      token.content = inside;
    }

    state.pos = end + 2;
    return true;
  });

  markdown.renderer.rules.kb_reference = (tokens, index) => {
    const inside = tokens[index].content;
    const escape = markdown.utils.escapeHtml;

    if (LABELS[inside]) {
      const kind = inside.replace(' ', '-');
      return `<span class="label ${kind}">${LABELS[inside]}</span>`;
    }

    const [reference, text] = inside.split('|');
    const [kind, ...rest] = reference.split(':');
    const target = rest.join(':');
    const { targets, up } = context;

    const link = (found: Target | undefined, code: boolean) => {
      if (!found) {
        context.errors.push(`${context.file}: no ${kind} ${target}`);
        return escape(text ?? target);
      }

      context.linked?.(found.url);

      const shown = escape(text ?? found.title);
      return `<a href="${up}${found.url}">${code && !text ? `<code>${shown}</code>` : shown}</a>`;
    };

    switch (kind) {
      case 'fn':
        return link(targets.functions.get(target.toUpperCase()), true);
      case 'topic':
        return link(targets.topics.get(target), false);
      case 'format':
        return link(targets.formats.get(target), false);
      case 'guide':
        return link(targets.guides.get(target), false);
      case 'probe':
        return link(targets.probes.get(target), true);
      case 'fonts': {
        const anchor = targets.fonts.get(target);

        if (!anchor) {
          context.errors.push(`${context.file}: no section ${target} in FONTS.md`);
          return escape(text ?? `FONTS.md ${target}`);
        }

        return `<a href="${context.fontsUrl}#${anchor}">${escape(text ?? `FONTS.md ${target}`)}</a>`;
      }
      default:
        context.errors.push(`${context.file}: [[${inside}]] is not a reference or a label`);
        return escape(inside);
    }
  };

  const fence = markdown.renderer.rules.fence!;

  markdown.renderer.rules.fence = (tokens, index, options, env, self) => {
    if (tokens[index].info.trim() === 'mermaid') {
      mermaid = true;
      return `<pre class="mermaid">${markdown.utils.escapeHtml(tokens[index].content)}</pre>\n`;
    }

    return fence(tokens, index, options, env, self);
  };

  /* Headings are one level down from the page's own title, which is its `h1`. */
  const html = markdown.render(body);
  return { html, mermaid };
}
