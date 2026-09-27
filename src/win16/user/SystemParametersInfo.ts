'use strict';

import { FALSE, TRUE } from '../consts.js';

const SPI_ICONHORIZONTALSPACING = 13;
const SPI_ICONVERTICALSPACING = 24;
const SPI_GETICONTITLEWRAP = 25;
const SPI_GETICONTITLELOGFONT = 31;

const SM_CXICONSPACING = 38;
const SM_CYICONSPACING = 39;

/**
 * The **SystemParametersInfo** function reads or sets a system-wide setting.
 *
 * What an icon is placed and labelled by is answered, as the `sizing` probe
 * recorded it on four displays: the icon spacing, whether titles wrap, and
 * the title's font -- MS Sans Serif, eight points on the display's vertical
 * resolution, normal weight. Nothing is set yet, and the other settings are
 * not answered.
 *
 * @param {Types.UINT} uAction - The setting.
 * @param {Types.UINT} uParam - Its parameter.
 * @param {Types.FARPTR} lpvParam - Where it is written.
 * @param {Types.UINT} fuWinIni - Whether a change goes to WIN.INI.
 *
 * @returns {Types.BOOL} Whether the setting was answered.
 */
export function SystemParametersInfo(uAction, uParam, lpvParam, _fuWinIni) {
  const core = this.machine.cpu.core;
  const segment = (lpvParam >>> 16) & 0xffff;
  const offset = lpvParam & 0xffff;
  const metrics = this.display?.metricsByIndex ?? {};

  const write16 = (at: number, value: number) => core.write16(segment, offset + at, value & 0xffff);

  if (!lpvParam) {
    return FALSE;
  }

  switch (uAction) {
    case SPI_ICONHORIZONTALSPACING:
      write16(0, metrics[SM_CXICONSPACING] ?? 75);
      return TRUE;

    case SPI_ICONVERTICALSPACING:
      write16(0, metrics[SM_CYICONSPACING] ?? 72);
      return TRUE;

    case SPI_GETICONTITLEWRAP:
      write16(0, 1);
      return TRUE;

    case SPI_GETICONTITLELOGFONT: {
      const face = 'MS Sans Serif';

      for (let at = 0; at < 50; at++) {
        core.write8(segment, offset + at, 0);
      }

      write16(0, -Math.round((8 * (this.display?.logicalPixelsY ?? 96)) / 72));
      write16(8, 400);

      for (let at = 0; at < face.length; at++) {
        core.write8(segment, offset + 18 + at, face.charCodeAt(at));
      }

      return TRUE;
    }
  }

  return FALSE;
}
