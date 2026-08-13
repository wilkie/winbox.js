/**
 * Entry point for the development demo page served by `pnpm dev`.
 *
 * This is not part of the distributed bundle. It exists so the windowing
 * engine can be poked at in a real browser during development, and so the
 * Playwright suite has a page to drive.
 */

import { Space } from './space.js';
import { SizableWindow } from './windows/sizable-window.js';
import { Button } from './controls/button.js';
import '../css/main.scss';

const element = document.getElementById('space');

if (!element) {
  throw new Error('demo: no #space element to render into');
}

const space = new Space({ title: 'WinBox.js' });
space.open(element);

const window_ = new SizableWindow();
window_.resize(320, 200);
window_.move(48, 48);
space.append(window_);

const button = new Button({ caption: 'OK' });
window_.append(button);

/* Handy for prodding the emulator from the browser console. */
Object.assign(globalThis as Record<string, unknown>, {
  space,
  demoWindow: window_,
  demoButton: button,
});
