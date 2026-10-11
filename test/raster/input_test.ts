'use strict';

import { DeviceBitmap } from '../../src/raster/device-bitmap.js';
import { HandleManager } from '../../src/win16/handle-manager.js';
import { User } from '../../src/win16/user.js';
import { Desktop } from '../../src/win16/user/desktop.js';
import {
  HTCAPTION,
  HTCLIENT,
  HTHSCROLL,
  HTMAXBUTTON,
  HTMENU,
  HTMINBUTTON,
  HTSYSMENU,
  HTVSCROLL,
  RasterInput,
  hitTest,
} from '../../src/win16/user/raster-input.js';
import { RasterWindow } from '../../src/win16/user/raster-window.js';
import { mouseTaken, noteClick, resolveMouse } from '../../src/win16/user/mouse-scan.js';
import { keyTarget, systemQueue } from '../../src/win16/user/system-queue.js';
import { chromeReady, displayEnvironment } from './chrome.js';

/**
 * The mouse and keyboard on the raster desktop: what a pointer or a key puts
 * in USER's system queue, which window a look gives it, and what a look
 * makes of the mouse's. Two windows of the `chrome` probe's ordinary style,
 * each with a program of its own, and window procedures that answer
 * `WM_NCHITTEST` and `WM_MOUSEACTIVATE` as `DefWindowProc` does and note
 * what they are sent.
 */

const OVERLAPPED = 0x00cf0000;
const CS_DBLCLKS = 0x0008;

(chromeReady('vga') ? describe : describe.skip)('input on the raster desktop', () => {
  let setup: any;

  beforeAll(async () => {
    setup = await displayEnvironment('vga');
  });

  const make = (classStyle = 0) => {
    const screen = new DeviceBitmap(640, 480, setup.depth, undefined, setup.palette);
    const desktop = new Desktop(screen, setup.environment);
    const handles = new HandleManager();
    const sent: [number, number, number, number][] = [];
    const system: any = {
      handles,
      rasterDesktop: desktop,
      _startTime: 0,
      scheduler: {
        windowTask: () => null,
        callWndProc: async (
          _: any,
          hwnd: number,
          message: number,
          wParam: number,
          lParam: number
        ) => {
          sent.push([hwnd, message, wParam, lParam]);

          if (message === User.WM_NCHITTEST) {
            const shown = desktop.windows.find((one) => one.hwnd === hwnd)!;

            return hitTest(desktop, shown, (lParam << 16) >> 16, lParam >> 16);
          }

          if (message === User.WM_MOUSEACTIVATE) {
            return (lParam & 0xffff) === HTCAPTION ? 3 : 1;
          }

          return 0;
        },
      },
    };
    const input = new RasterInput(system);
    const queues: any[][] = [];

    system.rasterInput = input;

    handles.register(handles.allocate({ style: classStyle }), 'Probe');

    /* One queue for every program: USER's system queue, whose events are
     * given their window only as a look takes them (`system-queue.ts`). */
    const queue = systemQueue(system);

    const window = (x: number, y: number, style = OVERLAPPED, menu?: string[]) => {
      const task = { signal: () => {} };
      const shown = desktop.create(x, y, 200, 120, style, 'Probe', menu, null);
      const handle = new RasterWindow(desktop, shown, { windowClass: 'Probe' });

      shown.hwnd = handles.allocate(handle);
      handle.data.hInstance = handles.allocate(task);
      desktop.show(shown);
      queues.push(queue);

      return { shown, queue };
    };

    /* The last of a queue as a look makes it, and as it is taken. */
    const look = async (queue: any[]) => {
      const outcome = await resolveMouse(system, { _input: queue }, queue.at(-1));

      return outcome.kind === 'resolved' ? outcome.resolved : (outcome as any);
    };
    const take = async (queue: any[]) => {
      const resolved = await look(queue);

      await mouseTaken(system, queue.at(-1), resolved);

      return resolved;
    };

    /* A press taken, kept as USER keeps one for the next's double click
     * (`mouse-scan.ts`). */
    const press = async (queue: any[]) => {
      const resolved = await look(queue);

      /* The double-click time and size, as `WIN.INI` has none to give here. */
      system._doubleClickTime ??= 500;
      system.display ??= { metrics: {}, metricsByIndex: { 36: 4, 37: 4 } };
      await noteClick(system, queue.at(-1), resolved);

      return resolved;
    };

    return { desktop, input, window, queues, look, take, press, sent, system };
  };

  const pointer = (x: number, y: number, extra: any = {}) => ({
    x,
    y,
    button: 0,
    buttons: 1,
    double: false,
    shift: false,
    control: false,
    ...extra,
  });

  it("puts a press in as the mouse made it, which a look makes a client area's, in client coordinates", async () => {
    const { input, window, look, sent } = make();
    const { shown, queue } = window(40, 40);

    input.pointer('down', pointer(100, 100));

    expect(queue).toHaveLength(1);
    expect(queue[0].hwnd).toBe(shown.hwnd);
    expect(queue[0].message).toBe(User.WM_LBUTTONDOWN);
    expect(queue[0].mouse).toMatchObject({ x: 100, y: 100, kind: User.WM_LBUTTONDOWN });

    /* Nothing is asked until the program looks. */
    expect(sent).toHaveLength(0);

    const resolved = await look(queue);

    expect(sent.map(([hwnd, message]) => [hwnd, message])).toEqual([
      [shown.hwnd, User.WM_NCHITTEST],
    ]);
    expect(resolved.hwnd).toBe(shown.hwnd);
    expect(resolved.message).toBe(User.WM_LBUTTONDOWN);
    expect(resolved.wParam).toBe(User.MK_LBUTTON);
    expect(resolved.lParam).toBe(
      ((100 - 40 - shown.client.left) & 0xffff) | ((100 - 40 - shown.client.top) << 16)
    );
  });

  it('makes a move over the caption a non-client move, in screen coordinates', async () => {
    const { input, window, look } = make();
    const { queue } = window(40, 40);

    input.pointer('move', pointer(120, 45, { buttons: 0 }));

    const resolved = await look(queue);

    expect(resolved.message).toBe(User.WM_NCMOUSEMOVE);
    expect(resolved.wParam).toBe(HTCAPTION);
    expect(resolved.lParam).toBe(120 | (45 << 16));
  });

  it('activates a window it presses on as the press is taken, and its keys follow the focus the activation gives', async () => {
    const { desktop, input, window, take, sent, system } = make();
    const first = window(40, 40);
    const second = window(300, 200);

    expect(second.shown.active).toBe(true);

    /* The two windows' own activations, as a system would have sent them. */
    desktop.pendingActivation = null;

    input.pointer('down', pointer(100, 100));

    expect(first.shown.active).toBe(false);

    await take(first.queue);

    expect(first.shown.active).toBe(true);
    expect(second.shown.active).toBe(false);

    /* Asked, brought to the front as `SetWindowPos` brings it (`alttab`),
     * made active by a press in its client area, and asked for the cursor
     * (`mousemsg`). */
    const told = sent
      .filter(([hwnd]) => hwnd === first.shown.hwnd)
      .map(([, message, wParam]) => [message, wParam]);

    expect(told).toEqual([
      [User.WM_NCHITTEST, 0],
      [User.WM_MOUSEACTIVATE, first.shown.hwnd],
      [User.WM_WINDOWPOSCHANGING, 0],
      [User.WM_WINDOWPOSCHANGED, 0],
      [0x001c, 1],
      [User.WM_NCACTIVATE, 1],
      [User.WM_ACTIVATE, 2],
      [0x0020, first.shown.hwnd],
    ]);
    desktop.focus = first.shown;

    input.key('down', { code: 'KeyA', key: 'a', repeat: false });

    expect(first.queue.at(-1).message).toBe(User.WM_KEYDOWN);
    expect(first.queue.at(-1).wParam).toBe(0x41);
    expect(input.typed.get(0x41)).toBe(0x61);

    /* Given the window with the focus as it is taken (`sysq`). */
    expect(keyTarget(system, first.queue.at(-1))?.hwnd).toBe(first.shown.hwnd);
    desktop.focus = second.shown;
    expect(keyTarget(system, first.queue.at(-1))?.hwnd).toBe(second.shown.hwnd);
  });

  it("gives the punctuation keys the US keyboard driver's virtual keys", () => {
    const { input, window } = make();
    const target = window(40, 40);

    input.key('down', { code: 'Equal', key: '+', repeat: false });

    expect(target.queue.at(-1).wParam).toBe(0xbb);
    expect(input.typed.get(0xbb)).toBe(0x2b);

    input.key('down', { code: 'Minus', key: '-', repeat: false });

    expect(target.queue.at(-1).wParam).toBe(0xbd);
  });

  it('makes system keys as KEYBD_EVENT does (`altchild`)', () => {
    const { input, window, system } = make();
    const { queue } = window(40, 40);
    const last = () => {
      const msg = queue.at(-1);

      return [msg.message, msg.wParam, (msg.lParam >>> 29) & 1];
    };

    /* Alt pressed: a system key, Alt down; released alone, one too, Alt up. */
    input.key('down', { code: 'AltLeft', key: 'Alt', repeat: false, alt: true });
    expect(last()).toEqual([User.WM_SYSKEYDOWN, User.VK_MENU, 1]);
    input.key('up', { code: 'AltLeft', key: 'Alt', repeat: false, alt: false });
    expect(last()).toEqual([User.WM_SYSKEYUP, User.VK_MENU, 0]);

    /* Released after another key, a plain release (`USER.EXE` seg1 `4c27`). */
    input.key('down', { code: 'AltLeft', key: 'Alt', repeat: false, alt: true });
    input.key('down', { code: 'F4', key: 'F4', repeat: false, alt: true });
    expect(last()).toEqual([User.WM_SYSKEYDOWN, 0x73, 1]);
    input.key('up', { code: 'AltLeft', key: 'Alt', repeat: false, alt: false });
    expect(last()).toEqual([User.WM_KEYUP, User.VK_MENU, 0]);

    /* F10 goes in as it is, and is one without Alt as it is taken (seg1
     * `3188`). */
    input.key('down', { code: 'F10', key: 'F10', repeat: false });
    expect(last()).toEqual([User.WM_KEYDOWN, 0x79, 0]);
    expect(keyTarget(system, queue.at(-1))?.message).toBe(User.WM_SYSKEYDOWN);
    input.key('up', { code: 'F10', key: 'F10', repeat: false });
    expect(last()).toEqual([User.WM_KEYUP, 0x79, 0]);
    expect(keyTarget(system, queue.at(-1))?.message).toBe(User.WM_SYSKEYUP);

    /* With Control down too, none is (seg1 `4c47`). */
    input.key('down', { code: 'ControlLeft', key: 'Control', repeat: false });
    input.key('down', { code: 'KeyX', key: 'x', repeat: false, alt: true });
    expect(last()).toEqual([User.WM_KEYDOWN, 0x58, 1]);
  });

  it('types a control character for Enter, Backspace, Tab and Escape', () => {
    const { input, window } = make();

    window(40, 40);

    for (const [code, typed] of [
      ['Enter', 0x0d],
      ['Backspace', 0x08],
      ['Tab', 0x09],
      ['Escape', 0x1b],
    ] as const) {
      input.key('down', { code, key: code, repeat: false });
      expect([...input.typed.values()].at(-1)).toBe(typed);
    }
  });

  it('makes a second press a double click only for a class that asks for them', async () => {
    const plain = make();
    const one = plain.window(40, 40);

    plain.input.pointer('down', pointer(100, 100));
    await plain.press(one.queue);
    plain.input.pointer('down', pointer(100, 100));
    expect((await plain.look(one.queue)).message).toBe(User.WM_LBUTTONDOWN);

    const asking = make(CS_DBLCLKS);
    const two = asking.window(40, 40);

    asking.input.pointer('down', pointer(100, 100));
    expect((await asking.press(two.queue)).message).toBe(User.WM_LBUTTONDOWN);
    asking.input.pointer('down', pointer(100, 100));
    expect((await asking.look(two.queue)).message).toBe(User.WM_LBUTTONDBLCLK);
  });

  it('sends everything to the window that captured the mouse', async () => {
    const { input, window, look } = make();
    const first = window(40, 40);

    input.capture = first.shown;
    input.pointer('move', pointer(600, 400, { buttons: 0 }));

    expect(first.queue).toHaveLength(1);
    expect((await look(first.queue)).message).toBe(User.WM_MOUSEMOVE);
  });

  it("gives a press on a minimized window's icon to it, not to its children (`iconkid`)", async () => {
    const { desktop, input, window, look, press } = make();
    const { shown, queue } = window(40, 40);
    const { left, top, clientWidth, clientHeight } = shown;
    const child = desktop.create(
      left + shown.client.left,
      top + shown.client.top,
      clientWidth,
      clientHeight,
      0x50000000,
      'Probe',
      undefined,
      null,
      shown
    );

    desktop.show(child);
    desktop.minimize(shown);

    const x = shown.left + (shown.width >> 1);
    const y = shown.top + (shown.height >> 1);

    input.pointer('down', pointer(x, y));
    await press(queue);
    input.pointer('down', pointer(x, y));

    const resolved = await look(queue);

    expect(resolved.hwnd).toBe(shown.hwnd);
    expect(resolved.message).toBe(User.WM_NCLBUTTONDBLCLK);
    expect(resolved.wParam).toBe(HTCAPTION);

    /* Restored, the child shows again and is owed a paint. */
    child.needsPaint = false;
    desktop.restore(shown);
    expect(desktop.windowAt(shown.left + 100, shown.top + 60)).toBe(child);
    expect(child.needsPaint).toBe(true);
  });

  it("gives a press on an icon's title to the icon's task as a press on a caption, the title not made active", async () => {
    const { desktop, input, window, take, press } = make();
    const { shown, queue } = window(40, 40);
    const other = window(300, 200);

    /* The title's handle and task, as `rasterDesktop` gives them: the icon's
     * task, whose queue its messages go to. */
    desktop.onTitle = (title) => {
      const icon = input.system.handles.resolve(title.titleOf!.hwnd);
      const handle = new RasterWindow(desktop, title, { windowClass: '#32772' });

      handle.data.hInstance = icon.data.hInstance;
      title.hwnd = input.system.handles.allocate(handle);
    };
    desktop.minimize(shown);
    desktop.show(other.shown);
    desktop.pendingActivation = null;

    const title = shown.iconTitle!;
    const x = title.left + (title.width >> 1);
    const y = title.top + (title.height >> 1);

    /* All caption, as USER's procedure for it answers `WM_NCHITTEST`
     * (`USER.EXE` seg1 `6dbd`). */
    expect(hitTest(desktop, title, x, y)).toBe(HTCAPTION);

    input.pointer('down', pointer(x, y));
    await press(queue);
    input.pointer('down', pointer(x, y));

    const resolved = await take(queue);

    expect(title.active).toBe(false);
    expect(other.shown.active).toBe(true);
    expect(desktop.pendingActivation).toBe(null);
    expect(resolved.hwnd).toBe(title.hwnd);
    expect(resolved.message).toBe(User.WM_NCLBUTTONDBLCLK);
    expect(resolved.wParam).toBe(HTCAPTION);
  });

  it("lets an icon's title go from its icon when it is destroyed on its own", () => {
    const { desktop, window } = make();
    const { shown } = window(40, 40);

    desktop.minimize(shown);

    const title = shown.iconTitle!;

    desktop.destroy(title);

    expect(shown.iconTitle).toBe(null);

    desktop.restore(shown);
    desktop.show(shown);
    expect(desktop.windows.includes(title)).toBe(false);
  });

  it('tells the parts of a window apart as DefWindowProc does', () => {
    const { desktop, window } = make();
    const { shown } = window(40, 40, OVERLAPPED | 0x00300000, ['&File']);
    const at = (x: number, y: number) => hitTest(desktop, shown, 40 + x, 40 + y);

    expect(at(10, 12)).toBe(HTSYSMENU);
    expect(at(100, 12)).toBe(HTCAPTION);
    expect(at(170, 12)).toBe(HTMINBUTTON);
    expect(at(190, 12)).toBe(HTMAXBUTTON);
    expect(at(100, shown.client.top - 5)).toBe(HTMENU);
    expect(at(100, shown.client.top + 5)).toBe(HTCLIENT);
    expect(at(shown.client.right + 3, shown.client.top + 5)).toBe(HTVSCROLL);
    expect(at(50, shown.client.bottom + 3)).toBe(HTHSCROLL);
  });
});
