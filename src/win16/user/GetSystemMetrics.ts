'use strict';

import { User } from '../user.js';

/**
 * The **GetSystemMetrics** function retrieves the dimensions of elements of
 * the Windows display.
 *
 * Several of these follow from the display driver rather than from Windows: a
 * caption bar is as tall as the system font needs it to be, so a lower
 * resolution gets a shorter one. Recorded from real Windows against each
 * driver, in `oracle/fixtures/devcaps-*.json`.
 *
 * @static
 * @function GetSystemMetrics
 * @memberof User
 *
 * @param {Types.INT} nIndex - The metric to retrieve.
 *
 * @return {Types.INT} The metric, or zero if it is one we do not describe.
 */
export function GetSystemMetrics(nIndex) {
  const display = this.display;
  const metrics = display.metrics;

  switch (nIndex) {
    case User.SM_CXSCREEN:
      return display.width;
    case User.SM_CYSCREEN:
      return display.height;

    /* The screen less the caption, on every display the `chrome` probe
     * recorded: 460 on a VGA, 332 on an EGA, 330 on a Hercules. */
    case User.SM_CXFULLSCREEN:
      return display.width;
    case User.SM_CYFULLSCREEN:
      return display.height - metrics.captionHeight;
  }

  /* Everything else the `chrome` probe recorded for this display. */
  const recorded = display.metricsByIndex?.[nIndex];

  if (recorded !== undefined) {
    return recorded;
  }

  switch (nIndex) {
    case User.SM_CYCAPTION:
      return metrics.captionHeight;
    case User.SM_CYMENU:
      return metrics.menuHeight;

    case User.SM_CXBORDER:
      return metrics.borderWidth;
    case User.SM_CYBORDER:
      return metrics.borderHeight;

    case User.SM_CXFRAME:
      return metrics.frameWidth;
    case User.SM_CYFRAME:
      return metrics.frameHeight;

    case User.SM_CXICON:
      return metrics.iconWidth;
    case User.SM_CYICON:
      return metrics.iconHeight;
  }

  return 0;
}
