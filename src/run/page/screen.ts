/**
 * How large the Windows screen is drawn on the page, and in what shape.
 *
 * The screen's canvas holds the display's own pixels, as many as the display
 * has (`makeScreen`); the page draws it larger or smaller with CSS, as a
 * monitor would have shown it. The functions here work out that size from
 * the room the page gives it; `../ui/desktop.tsx` measures the room and sets
 * the canvas's CSS size, and the mouse is mapped back through the canvas's
 * own box (`attachInput`), so a click lands on the same Windows pixel at any
 * size. No React here, nor the DOM but for the remembered choice: these are
 * tested from jest (`test/run/page_screen_test.ts`).
 *
 * ## The shape of each display
 *
 * Every display Windows 3.1 drove was shown on a 4:3 monitor, its picture
 * stretched to fill the tube, so a mode with fewer lines than 3/4 of its
 * columns has pixels taller than they are wide. The page shows each as
 * DOSBox, which the oracle records on, shows it with `aspect=true`
 * (`src/hardware/vga_draw.cpp`, `VGA_SetupDrawing`, 0.74-3):
 *
 * - 640x480 and larger (VGA, Super VGA 800x600, 8514/a and XGA 1024x768):
 *   4:3, "all > 640x480 modes" (1437-1440) -- square pixels, as each of
 *   these is 4:3 already. The drivers agree: VGA's ASPECTX and ASPECTY are
 *   36 and 36, the 1024x768 drivers' 10 and 10.
 * - EGA, 640x350: 4:3, the 350-line mode "depends on the monitor to stretch
 *   the screen" to the 480 lines of the same tube (1210-1213): each pixel
 *   480/350 = 1.37 times as tall as it is wide. The driver's own numbers say
 *   much the same (its 240 by 175 mm and 96 by 72 logical pixels to the
 *   inch, 1.33; its ASPECTX 38 to ASPECTY 48, 1.26).
 * - CGA, 640x200: 4:3, its 200 lines doubled to 400 and stretched as the
 *   EGA's are (`doubleheight`, 1308-1325): 2.4 times as tall. No display
 *   the page offers is a CGA, but its shape is here for one that is.
 * - Hercules, 720x348: DOSBox gives its graphics mode pixels 1.5 times as
 *   tall as they are wide (`M_HERC_GFX`, 1343-1344), a picture of 720 by
 *   522, 1.38 to 1 -- near 4:3, as the monochrome monitor showed it.
 *   (The driver claims 225 by 145 mm, and ASPECTX 11 to ASPECTY 16, 1.45:
 *   DOSBox's 1.5 is taken, being what Windows on the oracle was seen on.)
 * - Any other size: square pixels.
 */

import { Observable } from './observable.js';

/** How the screen is fitted to its room. */
export type ScreenScale = 'fit' | 'whole' | 'actual';

/** The choices, as the page offers them. */
export const SCALES: { value: ScreenScale; text: string }[] = [
  { value: 'fit', text: 'Fit' },
  { value: 'whole', text: 'Whole pixels' },
  { value: 'actual', text: 'Actual size' },
];

/** A width and a height. */
export interface Size {
  width: number;
  height: number;
}

/**
 * The shape a display's screen is shown in, its width over its height, as
 * a monitor of its day showed it (see above): from the canvas's own size.
 */
export function displayAspect({ width, height }: Size) {
  if (width === 720 && height === 348) {
    return 720 / (348 * 1.5);
  }

  /* 640x200 (CGA), 640x350 (EGA), 640x400: lines stretched to a 4:3 tube;
   * 640x480 and larger: 4:3, as DOSBox makes every mode that large. */
  if (width === 640 && height < 480) {
    return 4 / 3;
  }

  if (width >= 640 && height >= 480 && Math.abs(width / height - 4 / 3) < 0.01) {
    return 4 / 3;
  }

  return width / height;
}

/** How many times as tall as it is wide each of the display's pixels is shown. */
export const pixelAspect = (screen: Size) => screen.width / screen.height / displayAspect(screen);

/** What the screen is drawn as: its size in CSS pixels, and how its pixels are drawn. */
export interface ScreenBox extends Size {
  /** Whether each of the display's pixels is drawn an equal, whole number of device pixels. */
  whole: boolean;

  /**
   * The canvas's `image-rendering`: hard-edged (`pixelated`) where every
   * pixel is drawn whole, or at least two device pixels each way, where a
   * pixel one device pixel wider than its neighbour is not seen; smoothed
   * (`auto`) where the screen is drawn at under twice its size, where
   * hard edges make one stroke of a letter twice as thick as the next, or
   * smaller than its size, where they drop whole lines.
   */
  rendering: 'pixelated' | 'auto';
}

/** How a box is drawn: hard-edged where whole, or at two device pixels to the pixel or more each way. */
function rendered(box: Size & { whole: boolean }, screen: Size, ratio: number): ScreenBox {
  const across = (box.width * ratio) / screen.width;
  const down = (box.height * ratio) / screen.height;

  return {
    ...box,
    rendering: box.whole || Math.min(across, down) >= 2 ? 'pixelated' : 'auto',
  };
}

/**
 * The size the screen is drawn at, in CSS pixels, in a room of `room` CSS
 * pixels on a device of `ratio` device pixels to the CSS pixel:
 *
 * - `fit`: as large as the room allows, in the display's shape, at any scale.
 * - `whole`: the largest that draws each of the display's pixels as a whole
 *   number of device pixels across and a whole number down, as near the
 *   display's shape as whole numbers come (an EGA's 1.37 drawn 3 down to 2
 *   across, or 4 to 3); `fit` where even one device pixel each is too large.
 * - `actual`: one CSS pixel to each of the display's, as the page drew it
 *   before, its pixels square; smaller, in the same shape, where the room
 *   is too small for it.
 *
 * Sizes are whole CSS pixels but for `whole`, which is whole device pixels.
 */
export function screenBox(scale: ScreenScale, room: Size, screen: Size, ratio = 1): ScreenBox {
  const roomWidth = Math.max(0, room.width);
  const roomHeight = Math.max(0, room.height);

  if (scale === 'actual') {
    const shrink = Math.min(1, roomWidth / screen.width, roomHeight / screen.height);
    const width = Math.floor(screen.width * shrink);
    const height = Math.floor(screen.height * shrink);

    return rendered(
      { width, height, whole: shrink === 1 && ratio === Math.round(ratio) },
      screen,
      ratio
    );
  }

  if (scale === 'whole') {
    const tall = pixelAspect(screen);
    const across = Math.floor((roomWidth * ratio) / screen.width);

    for (let wide = across; wide >= 1; wide--) {
      const down = Math.max(1, Math.round(wide * tall));

      if (down * screen.height <= roomHeight * ratio) {
        return rendered(
          {
            width: (wide * screen.width) / ratio,
            height: (down * screen.height) / ratio,
            whole: true,
          },
          screen,
          ratio
        );
      }
    }
  }

  const aspect = displayAspect(screen);
  const width = Math.floor(Math.min(roomWidth, roomHeight * aspect));

  return rendered({ width, height: Math.floor(width / aspect), whole: false }, screen, ratio);
}

/* ---- the choice, remembered in this browser ---- */

/** Where the choice is kept: this browser's own storage for the page. */
const KEY = 'winbox.screenScale';

/** The choice remembered in this browser, `fit` where none is, or storage cannot be read. */
export function recallScale(storage: Pick<Storage, 'getItem'> | null = storageOf()): ScreenScale {
  try {
    const kept = storage?.getItem(KEY);

    return SCALES.some((one) => one.value === kept) ? (kept as ScreenScale) : 'fit';
  } catch {
    return 'fit';
  }
}

/** The choice remembered, where storage can be written; nothing said where it cannot. */
export function rememberScale(
  scale: ScreenScale,
  storage: Pick<Storage, 'setItem'> | null = storageOf()
) {
  try {
    storage?.setItem(KEY, scale);
  } catch {
    /* A private window, or storage blocked: the choice lasts the visit. */
  }
}

function storageOf(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The choice as it stands, which the desktop reads. */
export const screenScale = new Observable<ScreenScale>(recallScale());

/** The choice made, and remembered. */
export function chooseScale(scale: ScreenScale) {
  screenScale.set(scale);
  rememberScale(scale);
}
