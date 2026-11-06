import {
  displayAspect,
  pixelAspect,
  recallScale,
  rememberScale,
  screenBox,
} from '../../src/run/page/screen.js';
import { DISPLAY_MODES } from '../../src/win16/display-modes.js';

/**
 * How large the Windows screen is drawn, and in what shape
 * (`src/run/page/screen.ts`): each display as a 4:3 monitor of its day
 * showed it, DOSBox's way, and the three ways of fitting it to its room.
 */

const VGA = { width: 640, height: 480 };
const EGA = { width: 640, height: 350 };
const HERCULES = { width: 720, height: 348 };
const CGA = { width: 640, height: 200 };

describe('the shape of each display', () => {
  it('shows every display the page offers on a 4:3 monitor, the Hercules as DOSBox does', () => {
    const shapes = Object.fromEntries(
      Object.entries(DISPLAY_MODES).map(([name, mode]: [string, any]) => [
        name,
        Number(displayAspect(mode).toFixed(3)),
      ])
    );

    expect(shapes).toEqual({
      vga: 1.333,
      svga: 1.333,
      ega: 1.333,
      hercules: 1.379,
      vga256: 1.333,
      8514: 1.333,
      xga256: 1.333,
      '8514s': 1.333,
      xga256s: 1.333,
      xga640: 1.333,
    });
  });

  it('gives 4:3 modes square pixels, and stretches the lines of those with fewer', () => {
    expect(pixelAspect(VGA)).toBe(1);
    expect(pixelAspect({ width: 800, height: 600 })).toBe(1);
    expect(pixelAspect({ width: 1024, height: 768 })).toBe(1);
    expect(pixelAspect(EGA)).toBeCloseTo(480 / 350, 6);
    expect(pixelAspect(CGA)).toBeCloseTo(2.4, 6);
    expect(pixelAspect(HERCULES)).toBeCloseTo(1.5, 6);
  });

  it('leaves a size it does not know with square pixels', () => {
    expect(displayAspect({ width: 300, height: 200 })).toBe(1.5);
    expect(pixelAspect({ width: 300, height: 200 })).toBe(1);
  });
});

describe('the screen fitted to its room', () => {
  it('fills the room in the display’s shape, either way it is bounded', () => {
    expect(screenBox('fit', { width: 925, height: 840 }, VGA)).toEqual({
      width: 925,
      height: 693,
      whole: false,
      rendering: 'auto',
    });
    /* Bounded by its height: the bands are beside it. */
    expect(screenBox('fit', { width: 1600, height: 600 }, VGA)).toMatchObject({
      width: 800,
      height: 600,
    });
    /* An EGA's 350 lines drawn 4:3, as a VGA's 480 are. */
    expect(screenBox('fit', { width: 925, height: 840 }, EGA)).toMatchObject({
      width: 925,
      height: 693,
    });
    expect(screenBox('fit', { width: 1044, height: 2000 }, HERCULES)).toMatchObject({
      width: 1044,
      height: 756,
    });
  });

  it('draws pixels hard-edged at twice their size or more, smoothed under', () => {
    expect(screenBox('fit', { width: 1280, height: 960 }, VGA).rendering).toBe('pixelated');
    expect(screenBox('fit', { width: 1279, height: 960 }, VGA).rendering).toBe('auto');
    expect(screenBox('fit', { width: 640, height: 480 }, VGA, 2).rendering).toBe('pixelated');
    /* An EGA is drawn 2.74 times down to 2 across at 1280 wide: both at least 2. */
    expect(screenBox('fit', { width: 1280, height: 960 }, EGA).rendering).toBe('pixelated');
  });

  it('draws whole pixels as large as fit, in device pixels', () => {
    expect(screenBox('whole', { width: 1300, height: 1000 }, VGA)).toEqual({
      width: 1280,
      height: 960,
      whole: true,
      rendering: 'pixelated',
    });
    expect(screenBox('whole', { width: 925, height: 840 }, VGA)).toMatchObject({
      width: 640,
      height: 480,
    });
    /* Two device pixels to the CSS pixel: three of them a pixel is 1.5 CSS pixels. */
    expect(screenBox('whole', { width: 1000, height: 800 }, VGA, 2)).toMatchObject({
      width: 960,
      height: 720,
      whole: true,
    });
  });

  it('draws whole pixels as near the display’s shape as whole numbers come', () => {
    /* An EGA's pixel, 1.37 tall: 1 by 1 at first, then 2 across and 3 down, then 3 and 4. */
    expect(screenBox('whole', { width: 1000, height: 1000 }, EGA)).toMatchObject({
      width: 640,
      height: 350,
    });
    expect(screenBox('whole', { width: 1280, height: 1050 }, EGA)).toMatchObject({
      width: 1280,
      height: 1050,
    });
    expect(screenBox('whole', { width: 1920, height: 1400 }, EGA)).toMatchObject({
      width: 1920,
      height: 1400,
    });
    /* A Hercules' 1.5: 2 across and 3 down exactly. */
    expect(screenBox('whole', { width: 1440, height: 1044 }, HERCULES)).toMatchObject({
      width: 1440,
      height: 1044,
    });
  });

  it('fits the screen where the room is smaller than one device pixel to the pixel', () => {
    expect(screenBox('whole', { width: 525, height: 800 }, VGA)).toEqual({
      width: 525,
      height: 393,
      whole: false,
      rendering: 'auto',
    });
  });

  it('draws the actual size, one CSS pixel each, shrunk in its own shape where it must be', () => {
    expect(screenBox('actual', { width: 925, height: 840 }, EGA)).toEqual({
      width: 640,
      height: 350,
      whole: true,
      rendering: 'pixelated',
    });
    expect(screenBox('actual', { width: 320, height: 840 }, VGA)).toEqual({
      width: 320,
      height: 240,
      whole: false,
      rendering: 'auto',
    });
  });

  it('draws nothing in no room', () => {
    expect(screenBox('fit', { width: 0, height: 0 }, VGA)).toMatchObject({ width: 0, height: 0 });
    expect(screenBox('fit', { width: -5, height: 100 }, VGA)).toMatchObject({ width: 0 });
  });
});

describe('the choice, remembered in this browser', () => {
  const storage = () => {
    const kept = new Map<string, string>();

    return {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
    };
  };

  it('remembers the choice, and recalls it', () => {
    const kept = storage();

    expect(recallScale(kept)).toBe('fit');
    rememberScale('whole', kept);
    expect(recallScale(kept)).toBe('whole');
  });

  it('recalls fit for anything else kept, or storage that cannot be read or written', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };

    expect(recallScale({ getItem: () => 'huge' })).toBe('fit');
    expect(recallScale(throwing)).toBe('fit');
    expect(recallScale(null)).toBe('fit');
    expect(() => rememberScale('actual', throwing)).not.toThrow();
  });
});
