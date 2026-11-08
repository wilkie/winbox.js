import { matches, numbered } from '../../src/win16/kernel/FindResource.js';

/* A resource's name of `#` and digits is the number they make, to the
 * first that is not a digit, in a word; one that makes nought is a name
 * (`KRNL386.EXE` seg3 `0ac0`-`0af6`). Lode Runner's setup asks
 * `SETUPL.DLL`'s bitmap `#164` so (`kb/topics/win386.md`). */
describe('FindResource of a name of # and digits', () => {
  it('reads the number the digits make', () => {
    expect(numbered('#164')).toBe(164);
    expect(numbered('#12x')).toBe(12);
    expect(numbered('#65537')).toBe(1);
    expect(numbered('#0')).toBe(0);
    expect(numbered('#')).toBe(0);
    expect(numbered('SIERRAD')).toBe(0);
  });

  it('matches the resource of that number, and a name as a name', () => {
    expect(matches({ id: 164 }, '#164')).toBe(true);
    expect(matches({ id: 165 }, '#164')).toBe(false);
    expect(matches({ id: 'SIERRAD', name: 'SIERRAD' }, 'sierrad')).toBe(true);
  });
});
