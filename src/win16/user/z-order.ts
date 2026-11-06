'use strict';

/**
 * Where `SetWindowPos` puts a window at the top among the windows, and the
 * windows of its owner's family it brings with it, as `USER.EXE`'s
 * `EndDeferWindowPos` works it out (seg7 `01fd`): the window to go after and
 * whether it is made topmost or not (`1400`), the windows made so with it
 * (`13be`), the list of its owner's family (`12af`, `14ae`, `1606`),
 * whether each already lies where it is asked to go (`1184`, from
 * `0e09`-`0e38` before anything moves and `0a63`-`0a96` as each is placed),
 * and each linked after the window it is to go after, topmost changed as
 * it is (`0b46`-`0b71`). **Recorded** by `zorder` and `dlgfront`.
 *
 * The windows at the top are the desktop's, front first; an icon's title
 * is one of them, owned by its icon, from the time USER makes it (seg1
 * `6e25`). A window is named by its handle: `HWND_TOP` 0, `HWND_BOTTOM` 1.
 */

const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_NOOWNERZORDER = 0x0200;
const HWND_TOPMOST = 0xffff;
const HWND_NOTOPMOST = 0xfffe;

/** One window of the list: where it is to go, and what became of it. */
export interface ZEntry {
  member: any;
  /** The window it goes after, as `WM_WINDOWPOSCHANGING` and `CHANGED` name it. */
  after: number;
  /** Its flags, as the list has them: the window's own, or 13h for its family. */
  flags: number;
  /** Left where it lay: `SWP_NOZORDER` given or added (`0e38`), or found in place (`0a7c`). */
  stays: boolean;
  /** Linked where it was to go (`0b46`-`0b62`). */
  linked: boolean;
}

/** A window's list, and the windows made topmost or not with it. */
export interface ZPlan {
  entries: ZEntry[];
  /**
   * The windows to be made topmost or not as they are placed: those marked
   * now, and those left marked by an earlier call that marked them and did
   * not place them (`markedBefore`).
   */
  flip: Set<any>;
  /** The windows this call marks afresh, each marked or not (seg7 `13be`). */
  marked: Set<any>;
}

/** The windows at the top, the front first (the desktop's list of children). */
function siblings(desktop: any): any[] {
  return desktop.windows.filter(
    (other: any) => !other.parent && (!other.titleOf || other.titleOf.titleAsked)
  );
}

/** The window's handle, nought for one of WinBox's own without one. */
function handleOf(window: any): number {
  return window?.hwnd ?? 0;
}

function named(desktop: any, hwnd: number) {
  return hwnd > 1 ? (siblings(desktop).find((other) => other.hwnd === hwnd) ?? null) : null;
}

/** The window it is owned by, as the window at the top that one is in (seg7 `173a`). */
function ownerOf(window: any): any {
  let at = window.owner ?? window.titleOf ?? null;

  while (at?.parent) {
    at = at.parent;
  }

  return at === window ? null : at;
}

/** The windows at the top owned by one, front first (seg7 `177d`). */
function ownedBy(desktop: any, owner: any): any[] {
  return siblings(desktop).filter((other) => ownerOf(other) === owner);
}

/** The window at the end of its owners. */
function headOf(window: any) {
  const seen = new Set<any>();
  let head = window;

  for (let up = ownerOf(head); up && !seen.has(up); up = ownerOf(up)) {
    seen.add(head);
    head = up;
  }

  return head;
}

/** Whether a window is owned under `head`, or is it (seg7 `1700`). */
function inFamily(window: any, head: any) {
  const seen = new Set<any>();

  for (let at = window; at && !seen.has(at); at = ownerOf(at)) {
    if (at === head) {
      return true;
    }

    seen.add(at);
  }

  return false;
}

/**
 * The last of the topmost windows at the front, or none where the first is
 * not topmost (seg7 `02c9`): where `HWND_TOP` puts a window that is not.
 */
export function lastTopmost(desktop: any) {
  const tops = siblings(desktop);
  let last = null;

  for (const other of tops) {
    if (!other.topmost) {
      break;
    }

    last = other;
  }

  return last;
}

/**
 * The window to go after, as USER works it out from what it was asked
 * (seg7 `1400`), and whether the window is made topmost (1), topmost no
 * more (2), or neither (0).
 */
function resolve(desktop: any, window: any, after: number, flags: number) {
  const tops = siblings(desktop);
  const before = () => handleOf(tops[tops.indexOf(window) - 1]);

  /* Made active, to the top, unless it is the active window or was asked
   * for HWND_TOPMOST or HWND_NOTOPMOST (`1401`-`141b`). */
  if (
    !(flags & (SWP_NOZORDER | SWP_NOACTIVATE)) &&
    after !== HWND_TOPMOST &&
    after !== HWND_NOTOPMOST &&
    desktop.activeTop !== window
  ) {
    after = 0;
  }

  if (flags & SWP_NOZORDER) {
    return { after, change: 0 };
  }

  if (after === 1) {
    return { after, change: 2 };
  }

  /* After the last topmost window, or where it is the last, after the one
   * in front of it; one that is not topmost, after the one in front of it
   * (`1436`-`145d`). */
  if (after === HWND_NOTOPMOST) {
    if (window.topmost) {
      const last = lastTopmost(desktop);

      return { after: last === window ? before() : handleOf(last), change: 2 };
    }

    return { after: before(), change: 2 };
  }

  if (after === HWND_TOPMOST) {
    return { after: 0, change: 1 };
  }

  if (after === 0) {
    return { after: window.topmost ? 0 : handleOf(lastTopmost(desktop)), change: 0 };
  }

  /* After a window: the last topmost leaves it as it was (`1486`-`148d`);
   * another topmost one makes it topmost, one that is not, not. */
  if (handleOf(lastTopmost(desktop)) === after) {
    return { after, change: 0 };
  }

  if (named(desktop, after)?.topmost) {
    return { after, change: window.topmost ? 0 : 1 };
  }

  return { after, change: window.topmost ? 2 : 0 };
}

/**
 * The windows made topmost, or topmost no more, as the window is: made
 * topmost, it and the windows owned under it; made not, the window at the
 * end of its owners and every window owned under that (seg7 `137c`-`13a5`,
 * `13be`). Those already so are left.
 */
function flipped(desktop: any, window: any, change: number) {
  const flip = new Set<any>();
  const marked = new Set<any>();

  if (change) {
    const want = change === 1;
    const mark = (at: any) => {
      marked.add(at);

      if (!!at.topmost !== want) {
        flip.add(at);
      }

      for (const owned of ownedBy(desktop, at)) {
        if (owned !== at && !marked.has(owned)) {
          mark(owned);
        }
      }
    };

    mark(change === 2 ? headOf(window) : window);
  }

  /* Each marked afresh (`13c6` takes the mark off first); any other keeps
   * the mark an earlier call left it, where `SWP_NOOWNERZORDER` left it out
   * of that call's list (`zmark`). */
  for (const other of siblings(desktop)) {
    if (!marked.has(other) && markedBefore(other)) {
      flip.add(other);
    }
  }

  return { flip, marked };
}

/**
 * Whether a window was left marked to be made topmost or not as it is
 * next placed: its byte at 26h, bit 20h (seg7 `13de`), taken off as it is
 * placed (`0b67`-`0b71`). **Recorded** by `zmark`.
 */
export function markedBefore(window: any) {
  return !!window.topmostDue;
}

/**
 * A window placed by a `SetWindowPos` that did more than leave it where it
 * lies -- moved, sized, shown or hidden with `SWP_NOZORDER` -- made topmost
 * or not where it was left marked so (seg7 `0a4f`-`0a60`, `0b46`-`0b71`):
 * `zmark`'s Q, marked by its owner made topmost alone, is made topmost as
 * it is moved, and not as it is asked for nothing.
 */
export function placedMarked(desktop: any, window: any, flags: number) {
  if (markedBefore(window) && ((flags | 0x1800) & 0x18e7) !== 0x1807) {
    window.topmostDue = false;
    desktop.flipTopmost(window);
  }
}

/**
 * The family listed from `node`: each window it owns, front to back, with
 * the windows it owns before it, and `node` last; the branch the window
 * moved is in where it was asked among them (seg7 `1606`-`16f8`, `15d7`).
 */
function listed(desktop: any, node: any, window: any, after: number, seen: Set<any>): any[] {
  if (seen.has(node)) {
    return [];
  }

  seen.add(node);

  let branch = window;

  while (branch && ownerOf(branch) !== node) {
    branch = ownerOf(branch);
  }

  const tops = siblings(desktop);
  /* Whether the place asked lies in front of `at` (`15d7`). */
  const inFront = (at: any) =>
    after === 0 ||
    (after !== 1 && !tops.slice(tops.indexOf(at)).some((other) => other.hwnd === after));
  const out: any[] = [];
  let done = false;

  for (const at of ownedBy(desktop, node)) {
    if (branch && !done && inFront(at)) {
      out.push(...listed(desktop, branch, window, after, seen));
      done = true;
    }

    if (at !== branch) {
      out.push(...listed(desktop, at, null, 0, seen));
    }
  }

  if (branch && !done) {
    out.push(...listed(desktop, branch, window, after, seen));
  }

  out.push(node);
  return out;
}

/**
 * A window at the top's list, asked to go after `asked` with `flags`: the
 * windows of its owner's family it brings, each to go after the one before,
 * and the windows made topmost or not with it.
 */
export function planZOrder(
  desktop: any,
  window: any,
  asked: number,
  flags: number,
  errorBox: boolean
): ZPlan {
  const { after, change } = resolve(desktop, window, asked & 0xffff, flags);
  const { flip, marked } = flipped(desktop, window, change);
  const alone = (stays = !!(flags & SWP_NOZORDER)): ZPlan => ({
    entries: [{ member: window, after, flags, stays, linked: false }],
    flip,
    marked,
  });

  /* Nothing brought: not put elsewhere, `SWP_NOOWNERZORDER`, or a window
   * owned by none that owns none (`14c1`-`14f7`). */
  if (flags & (SWP_NOZORDER | SWP_NOOWNERZORDER) || errorBox) {
    return alone();
  }

  const owned = ownedBy(desktop, window);
  const owner = ownerOf(window);

  if (!owner && !owned.length) {
    return alone();
  }

  const head = headOf(window);
  const tops = siblings(desktop);
  let place = after;

  if (after === 1) {
    /* At the bottom: after the last window not of the family; with none,
     * where it lies (`151b`-`1548`). */
    for (const other of tops) {
      if (!inFamily(other, head)) {
        place = handleOf(other);
      }
    }

    if (place === 1) {
      return alone(true);
    }
  } else if (after) {
    const other = named(desktop, after);

    if (other && inFamily(other, head)) {
      /* After a window of its own family: one that owns nothing, with its
       * owner at or behind that window, goes there alone (`158b`-`159c`);
       * else the family stays where its first window lies, after the last
       * window in front of it (`15a2`-`15c4`). */
      if (!owned.length && tops.slice(tops.indexOf(other)).includes(owner)) {
        return alone();
      }

      place = 0;

      for (const one of tops) {
        if (inFamily(one, head)) {
          break;
        }

        place = handleOf(one);
      }
    }
  }

  const members = listed(desktop, head, window, after, new Set());

  return {
    entries: members.map((member, at) => ({
      member,
      after: at ? handleOf(members[at - 1]) : place,
      flags: member === window ? flags : SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE,
      stays: false,
      linked: false,
    })),
    flip,
    marked,
  };
}

/**
 * Whether a window already lies where its entry asks (seg7 `1184`): at the
 * bottom, the last; at the top, the first; after a window, right after it.
 * Asked to go after a window topmost where it is not to be, or not where it
 * is, it is to go after the last topmost window instead, and the entry says
 * so (`11ad`-`11d8`); it is the last topmost itself, it lies there.
 */
export function liesWhere(desktop: any, entry: ZEntry, flip: Set<any>) {
  const window = entry.member;
  const tops = siblings(desktop);
  const at = tops.indexOf(window);

  if (entry.after === 1) {
    return at === tops.length - 1;
  }

  if (entry.after === 0) {
    return at === 0;
  }

  const wanted = !!window.topmost !== flip.has(window);

  if (!!named(desktop, entry.after)?.topmost !== wanted) {
    const last = lastTopmost(desktop);

    if (last === window) {
      return true;
    }

    entry.after = handleOf(last);
  }

  if (at <= 0) {
    return false;
  }

  return handleOf(tops[at - 1]) === entry.after;
}

/**
 * Before anything moves, each entry that lies where it is asked while every
 * one before it did is left where it is (seg7 `0e09`-`0e38`); one made
 * topmost or not breaks the run. Answers whether the run is still unbroken.
 */
export function stayRun(desktop: any, plan: ZPlan, unbroken: boolean) {
  for (const entry of plan.entries) {
    if (entry.stays) {
      continue;
    }

    if (unbroken) {
      unbroken = false;

      if (!plan.flip.has(entry.member) && liesWhere(desktop, entry, plan.flip)) {
        unbroken = true;
        entry.stays = true;
      }
    }
  }

  return unbroken;
}

/**
 * Each entry placed, in the list's order (seg7 `0a4f`-`0b71`): one left
 * where it is passed over; one only put elsewhere -- its family, or the
 * window itself asked for nothing else (`placedOnly`) -- that lies where it
 * is asked is left there; any other is linked after the window it is to go
 * after, and made topmost or not as marked.
 */
export function placePlan(desktop: any, plan: ZPlan, window: any, placedOnly: boolean) {
  /* The marks this call made, kept on windows it does not place. */
  for (const marked of plan.marked) {
    marked.topmostDue = plan.flip.has(marked);
  }

  for (const entry of plan.entries) {
    if (entry.stays) {
      continue;
    }

    const only = entry.member !== window;

    if (
      (only || placedOnly) &&
      !plan.flip.has(entry.member) &&
      liesWhere(desktop, entry, plan.flip)
    ) {
      entry.stays = true;
      continue;
    }

    desktop.linkAfter(entry.member, entry.after);
    entry.linked = true;

    if (plan.flip.has(entry.member)) {
      entry.member.topmostDue = false;
      desktop.flipTopmost(entry.member);
    }
  }
}
