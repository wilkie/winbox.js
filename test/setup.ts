/**
 * Jest setup shared by every test file.
 *
 * The visibility matchers came over from the karma-jasmine-dom suite. They only
 * mean anything in a DOM environment; browser-level assertions now generally
 * belong in the Playwright suite under `e2e/`.
 */

expect.extend({
  toBeVisible(element: HTMLElement) {
    const pass = element.offsetWidth > 0 && element.offsetHeight > 0;
    return {
      pass,
      message: () => `expected element ${pass ? 'not ' : ''}to be visible`,
    };
  },

  toBeHidden(element: HTMLElement) {
    const pass =
      element.offsetWidth <= 0 || element.offsetHeight <= 0 || element.hasAttribute('hidden');
    return {
      pass,
      message: () => `expected element ${pass ? 'not ' : ''}to be hidden`,
    };
  },
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toBeVisible(): R;
      toBeHidden(): R;
    }
  }
}

export {};
