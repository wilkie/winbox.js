'use strict';

/**
 * USER's system error box (`USER.EXE` seg1 `9325`, export 320): a box drawn
 * straight on the screen over every window, with no window of its own, and
 * a loop of its own over the mouse and the keyboard in which no program
 * runs. KERNEL shows it when a program faults (see `kernel/fault.ts`).
 * **Read out**, and **recorded** by `fault` through the screen: the box and
 * both its buttons agree with Windows' pixel for pixel.
 *
 * * The text is split at `\n` into at most three lines; the rest is lost.
 * * The box is `10 cyC` high, and wide enough for the widest line or the
 *   caption with `6 cxC` to spare, and for three buttons at least; in the
 *   middle of the screen. White, in a frame of `COLOR_WINDOWFRAME` one
 *   pixel wide and `COLOR_ACTIVECAPTION` four.
 * * The caption is a row down, and the lines from the fourth row, the third
 *   for three lines, each in the middle.
 * * Three places for buttons, each a quarter of the way along, `2 cyC`
 *   above the bottom: a place with no button is left empty.
 * * It answers the place chosen, 1 to 3.
 */

export const SEB_OK = 1;
export const SEB_CANCEL = 2;
export const SEB_YES = 3;
export const SEB_NO = 4;
export const SEB_RETRY = 5;
export const SEB_ABORT = 6;
export const SEB_IGNORE = 7;
export const SEB_CLOSE = 8;
export const SEB_DEFBUTTON = 0x8000;

/** Each button's label and the letter that chooses it (USER's strings 54h to 5Bh, 72h). */
const LABELS: Record<number, { label: string; mnemonic: string }> = {
  [SEB_OK]: { label: 'OK', mnemonic: '' },
  [SEB_CANCEL]: { label: 'Cancel', mnemonic: '' },
  [SEB_YES]: { label: '&Yes', mnemonic: 'y' },
  [SEB_NO]: { label: '&No', mnemonic: 'n' },
  [SEB_RETRY]: { label: '&Retry', mnemonic: 'r' },
  [SEB_ABORT]: { label: '&Abort', mnemonic: 'a' },
  [SEB_IGNORE]: { label: '&Ignore', mnemonic: 'i' },
  [SEB_CLOSE]: { label: '&Close', mnemonic: 'c' },
};

const COLOR_ACTIVECAPTION = 2;
const COLOR_WINDOWFRAME = 6;
const COLOR_BTNFACE = 15;
const COLOR_BTNSHADOW = 16;
const COLOR_BTNTEXT = 18;
const COLOR_BTNHIGHLIGHT = 20;
const WHITE = 0xffffff;
const BLACK = 0x000000;

const VK_TAB = 0x09;
const VK_RETURN = 0x0d;
const VK_ESCAPE = 0x1b;
const VK_SPACE = 0x20;
const WM_KEYDOWN = 0x0100;
const WM_KEYUP = 0x0101;
const WM_SYSKEYDOWN = 0x0104;
const WM_MOUSEMOVE = 0x0200;
const WM_LBUTTONDOWN = 0x0201;
const WM_LBUTTONUP = 0x0202;

interface Button {
  id: number;
  focus: boolean;
  pressed: boolean;
  rect: [number, number, number, number];
}

/** Where everything goes, for a text, a caption and three places' buttons. */
export function sysErrorBoxLayout(desktop: any, text: string, caption: string, buttons: number[]) {
  const font = desktop.environment.font;
  const cx = font.average;
  const cy = font.height;
  const measure = (line: string) => desktop.measureSystem(line);
  const buttonWidth = 2 * cy + measure('Ignore') + 2 * measure('0');

  const lines: string[] = [];
  let rest = text;

  while (lines.length < 3) {
    const at = rest.indexOf('\n');

    if (at < 0) {
      lines.push(rest);
      break;
    }

    lines.push(rest.slice(0, at));
    rest = rest.slice(at + 1);

    /* A `\n` with nothing after it starts no line. */
    if (!rest) {
      break;
    }
  }

  const widest = Math.max(0, ...lines.map(measure));
  const width = Math.max(6 * cx + widest, 6 * cx + measure(caption), 3 * (4 * cy + buttonWidth));
  const height = 10 * cy;
  const screen = desktop.screen;
  const left = Math.max(0, (screen.width >> 1) - (width >> 1));
  const top = (screen.height >> 1) - (height >> 1);
  const right = left + width;
  const bottom = top + height;
  const middle = (left + right) >> 1;
  const step = width >> 2;
  const first = top + (lines.length === 3 ? 3 : 4) * cy;

  return {
    box: [left, top, right, bottom] as [number, number, number, number],
    caption: { text: caption, x: middle - (measure(caption) >> 1), y: top + cy },
    lines: lines.map((line, index) => ({
      text: line,
      x: middle - (measure(line) >> 1),
      y: first + index * cy,
    })),
    buttons: buttons.map((word, slot): Button | null => {
      const id = word & 0x7fff;

      if (!id || !LABELS[id]) {
        return null;
      }

      const centreX = left + (slot + 1) * step;
      const centreY = bottom - 2 * cy;
      const l = centreX - (buttonWidth >> 1);
      const t = centreY - cy;

      return {
        id,
        focus: (word & SEB_DEFBUTTON) !== 0,
        pressed: false,
        rect: [l, t, l + buttonWidth, t + 2 * cy],
      };
    }),
  };
}

/** A frame `m` wide inside a rectangle, in four blocks that meet at the corners. */
function frame(desktop: any, [l, t, r, b]: number[], m: number, colour: number) {
  desktop.screenFill(l, t, m, b - t - m, colour);
  desktop.screenFill(l + m, t, r - l - m, m, colour);
  desktop.screenFill(l, b - m, r - l - m, m, colour);
  desktop.screenFill(r - m, t + m, m, b - t - m, colour);
}

/** A button's face, as the box draws it (seg1 `8e0c`, `9201`, `916a`). */
function drawButton(desktop: any, button: Button, sysColor: (index: number) => number) {
  const [l, t, r, b] = button.rect;
  const m = button.focus ? 2 : 1;
  const face = sysColor(COLOR_BTNFACE);
  const shadow = sysColor(COLOR_BTNSHADOW);
  const highlight = sysColor(COLOR_BTNHIGHLIGHT);

  frame(desktop, button.rect, m, sysColor(COLOR_WINDOWFRAME));

  /* Round corners. */
  for (const [x, y] of [
    [l, t],
    [r - 1, t],
    [l, b - 1],
    [r - 1, b - 1],
  ]) {
    desktop.screenFill(x, y, 1, 1, WHITE);
  }

  const [il, it, ir, ib] = [l + m, t + m, r - m, b - m];

  if ((shadow & 0xffffff) === WHITE) {
    desktop.screenFill(il, it, ir - il, ib - it, face);
  } else if (button.pressed) {
    desktop.screenFill(il, it, 1, ib - it, shadow);
    desktop.screenFill(il, it, ir - il, 1, shadow);
    desktop.screenFill(il + 1, it + 1, ir - il - 1, ib - it - 1, face);
  } else {
    desktop.screenFill(il, it, 2, ib - it, highlight);
    desktop.screenFill(il, it, ir - il, 2, highlight);

    for (let inset = 0; inset < 2; inset++) {
      const rr = ir - 1 - inset;
      const bb = ib - 1 - inset;
      const ll = il + inset;
      const tt = it + inset;

      desktop.screenFill(ll, bb, rr - ll + 1, 1, shadow);
      desktop.screenFill(rr, tt, 1, bb - tt, shadow);
    }

    desktop.screenFill(il + 2, it + 2, ir - il - 4, ib - it - 4, face);
  }

  /* The label, its letter underlined, and the focus's dotted rectangle. */
  const { label } = LABELS[button.id];
  const at = label.indexOf('&');
  const plain = label.replace('&', '');
  const font = desktop.environment.font;
  const width = desktop.measureSystem(plain);
  const height = font.height;
  const shift = button.pressed ? 1 : 0;
  const x = ((l + r) >> 1) - (width >> 1) + shift;
  const y = ((t + b) >> 1) - (height >> 1) + shift;
  const text = sysColor(COLOR_BTNTEXT);

  desktop.screenText(x, y, plain, text);

  if (at >= 0) {
    const before = desktop.measureSystem(plain.slice(0, at));
    const letter = desktop.measureSystem(plain[at]);
    const overhang = font.overhang ?? 0;

    desktop.screenFill(
      x + before - overhang,
      y + font.ascent + 1,
      letter - (overhang >> 1),
      1,
      text
    );
  }

  if (button.focus) {
    const fl = l + ((r - l - width) >> 1) - 2 + shift;
    const ft = t + ((b - t - height) >> 1) - 1 + shift;
    const fr = fl + width + 4;
    const fb = ft + height + 3;

    for (let px = fl; px < fr; px++) {
      for (const py of [ft, fb - 1]) {
        desktop.screenFill(px, py, 1, 1, (px + py) & 1 ? WHITE : BLACK);
      }
    }

    for (let py = ft; py < fb; py++) {
      for (const px of [fl, fr - 1]) {
        desktop.screenFill(px, py, 1, 1, (px + py) & 1 ? WHITE : BLACK);
      }
    }
  }
}

/** Draws the whole box. */
export function drawSysErrorBox(
  desktop: any,
  layout: ReturnType<typeof sysErrorBoxLayout>,
  sysColor: (index: number) => number
) {
  const [left, top, right, bottom] = layout.box;

  desktop.screenFill(left, top, right - left, bottom - top, WHITE);
  frame(desktop, layout.box, 1, sysColor(COLOR_WINDOWFRAME));
  frame(desktop, [left + 1, top + 1, right - 1, bottom - 1], 4, sysColor(COLOR_ACTIVECAPTION));
  desktop.screenText(layout.caption.x, layout.caption.y, layout.caption.text, BLACK);

  for (const line of layout.lines) {
    desktop.screenText(line.x, line.y, line.text, BLACK);
  }

  for (const button of layout.buttons) {
    if (button) {
      drawButton(desktop, button, sysColor);
    }
  }
}

/**
 * Shows the box and waits for a button to be chosen: its place, 1 to 3, or
 * nought with no screen to draw on. The mouse and the keyboard go to the box
 * alone (seg1 `9759`): a press and release on a button chooses it; Enter or
 * Space chooses the focus's button as the key comes up; Tab moves the focus,
 * and the thick border with it, always onwards; Escape chooses Cancel, if
 * there is one; a button's letter, with Alt or not, chooses it at once.
 * Afterwards what the box covered is drawn again.
 */
export async function sysErrorBox(system: any, text: string, caption: string, buttons: number[]) {
  const desktop = system.rasterDesktop;
  const input = system.rasterInput;

  if (!desktop || !input) {
    return 0;
  }

  const sysColor = (index: number) => desktop.environment.sysColor(index);
  const layout = sysErrorBoxLayout(desktop, text, caption, buttons);
  const slots = layout.buttons;
  const redraw = (button: Button | null) => button && drawButton(desktop, button, sysColor);

  drawSysErrorBox(desktop, layout, sysColor);
  system.sysErrorBoxShown?.(layout);

  let focus = slots.findIndex((button) => button?.focus);
  let tracking = false;
  let keyDown = false;

  const inside = (button: Button | null, x: number, y: number) =>
    !!button &&
    x >= button.rect[0] &&
    x < button.rect[2] &&
    y >= button.rect[1] &&
    y < button.rect[3];
  const press = (slot: number, pressed: boolean) => {
    const button = slots[slot];

    if (button && button.pressed !== pressed) {
      button.pressed = pressed;
      redraw(button);
    }
  };
  const byLetter = (key: number) => {
    const letter = String.fromCharCode(key | 0x20);

    return slots.findIndex((button) => button && LABELS[button.id].mnemonic === letter);
  };

  const result = await new Promise<number>((done) => {
    input.modal = (message: number, wParam: number, x: number, y: number) => {
      switch (message) {
        case WM_LBUTTONDOWN: {
          tracking = true;

          const hit = slots.findIndex((button) => inside(button, x, y));

          if (hit >= 0) {
            if (focus >= 0 && hit !== focus) {
              slots[focus]!.focus = false;
              redraw(slots[focus]);
            }

            focus = hit;
            slots[hit]!.focus = true;
            press(hit, true);
          }

          break;
        }

        case WM_MOUSEMOVE:
          if (tracking) {
            slots.forEach((button, slot) => press(slot, inside(button, x, y) && slot === focus));
          }

          break;

        case WM_LBUTTONUP: {
          tracking = false;

          const pressed = slots.findIndex((button) => button?.pressed);

          if (pressed >= 0) {
            done(pressed + 1);
          }

          break;
        }

        case WM_KEYDOWN:
          if (wParam === VK_RETURN || wParam === VK_SPACE) {
            if (focus >= 0 && !keyDown) {
              keyDown = true;
              press(focus, true);
            }
          } else if (wParam === VK_TAB) {
            if (focus >= 0) {
              slots[focus]!.focus = false;
              redraw(slots[focus]);

              do {
                focus = (focus + 1) % 3;
              } while (!slots[focus]);

              slots[focus]!.focus = true;
              redraw(slots[focus]);
            }
          } else if (wParam === VK_ESCAPE) {
            const cancel = slots.findIndex((button) => button?.id === SEB_CANCEL);

            if (cancel >= 0) {
              done(cancel + 1);
            }
          } else {
            const chosen = byLetter(wParam);

            if (chosen >= 0) {
              done(chosen + 1);
            }
          }

          break;

        case WM_SYSKEYDOWN: {
          const chosen = byLetter(wParam);

          if (chosen >= 0) {
            done(chosen + 1);
          }

          break;
        }

        case WM_KEYUP:
          if ((wParam === VK_RETURN || wParam === VK_SPACE) && keyDown && focus >= 0) {
            done(focus + 1);
          }

          break;
      }
    };
  });

  input.modal = null;
  desktop.redrawArea(...layout.box);

  return result;
}

/**
 * The box as a program calls it: its text, its caption, and the button for
 * each of the three places, a `SEB_` number with `SEB_DEFBUTTON` for the
 * one with the focus, nought for none. It answers the place chosen, 1 to 3.
 */
export async function SysErrorBox(
  this: any,
  lpszText: any,
  lpszCaption: any,
  btn1: number,
  btn2: number,
  btn3: number
) {
  return sysErrorBox(
    this,
    lpszText ? String(lpszText) : '',
    lpszCaption ? String(lpszCaption) : '',
    [btn1 & 0xffff, btn2 & 0xffff, btn3 & 0xffff]
  );
}
