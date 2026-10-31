'use strict';

import {
  type Kind,
  OLE_ERROR_GENERIC,
  OLE_ERROR_MEMORY,
  OLE_ERROR_NOT_EQUAL,
  OLE_ERROR_STATIC,
  OLE_OK,
  Ole,
} from './core.js';
import { draw, mfCallback } from './draw.js';
import {
  changeData,
  clone,
  copyToClipboard,
  enumFormat,
  equal,
  genSetData,
  getData,
  queryBounds,
  querySize,
  release,
  saveToStream,
} from './kinds.js';
import { LE_METHODS, PB_METHODS, querySize as leQuerySize } from './linked.js';
import { kindOf, queryName, queryType, rename } from './objects.js';

/**
 * The methods of WinBox's objects, by the ordinal of the export each is:
 * what an `Ole` function finds in an object's table and calls, and what a
 * program calling the table itself reaches. As
 * `crates/winbox-win16/src/olecli/methods.rs`.
 */

/** A method's answer from its arguments, the object first. */
type Implementation = (ole: Ole, args: number[]) => Promise<number> | number;

/**
 * The methods a static object refuses, the `ERR` exports and the unnamed
 * entries its table holds (**measured** by `olemem`'s `direct` records,
 * each called through the table): `OLE_ERROR_STATIC`, but `ERRSETDATA` and
 * `ERRSETBOUNDS` `OLE_ERROR_MEMORY`, `ERRQUERYOUTOFDATE` `OLE_OK`, and
 * `ERRQUERYPROTOCOL` NULL. `ERRGETUPDATEOPTIONS` writes nothing.
 */
const REFUSED: Record<number, number> = {
  701: OLE_ERROR_STATIC,
  702: OLE_ERROR_MEMORY,
  703: OLE_ERROR_STATIC,
  704: OLE_ERROR_STATIC,
  705: OLE_ERROR_MEMORY,
  706: OLE_ERROR_STATIC,
  707: OLE_ERROR_STATIC,
  708: OLE_ERROR_STATIC,
  709: OLE_ERROR_STATIC,
  710: OLE_ERROR_STATIC,
  711: OLE_ERROR_STATIC,
  712: 0,
  713: OLE_OK,
  714: OLE_ERROR_STATIC,
  715: OLE_ERROR_STATIC,
  716: OLE_ERROR_STATIC,
  717: OLE_ERROR_STATIC,
  718: OLE_ERROR_STATIC,
  1026: OLE_ERROR_STATIC,
  1027: OLE_ERROR_STATIC,
  1028: OLE_ERROR_STATIC,
  1029: OLE_ERROR_STATIC,
  1030: OLE_ERROR_GENERIC,
};

/** A kind's methods at its hundred, given the kind. */
function kindMethods(kind: Kind, base: number): Record<number, Implementation> {
  const own = (ole: Ole, object: number) => kindOf(ole, object) ?? kind;

  return {
    [base]: (ole, [object]) => release(ole, own(ole, object), object),
    [base + 1]: (ole, [object, format, out]) => getData(ole, own(ole, object), object, format, out),
    [base + 2]: (ole, [object, stream]) => saveToStream(ole, own(ole, object), object, stream),
    [base + 3]: (ole, [object, client, doc, name, out]) =>
      clone(ole, own(ole, object), object, client, doc, name, out),
    [base + 4]: async (ole, [a, b]) =>
      kindOf(ole, b) === own(ole, a) ? equal(ole, own(ole, a), a, b) : OLE_ERROR_NOT_EQUAL,
    [base + 5]: (ole, [object]) => copyToClipboard(ole, own(ole, object), object),
    [base + 7]: (ole, [object, rect]) => queryBounds(ole, own(ole, object), object, rect),
    [base + 8]: (ole, [object, dc, bounds, window]) =>
      draw(ole, own(ole, object), object, dc, bounds, window),
    [base + 9]: (ole, [object, format]) => enumFormat(ole, own(ole, object), object, format),
    [base + 10]: (ole, [object, handle, client, release]) =>
      changeData(ole, own(ole, object), object, handle, client, release),
  };
}

/** The methods each kind's table holds, by ordinal. */
export const METHOD_IMPLEMENTATIONS: Record<number, Implementation> = {
  ...Object.fromEntries(
    Object.entries(REFUSED).map(([ordinal, answer]) => [ordinal, () => answer])
  ),
  ...kindMethods('mf', 300),
  ...kindMethods('bm', 400),
  ...kindMethods('dib', 500),
  600: (ole, [object]) => release(ole, 'gen', object),
  601: (ole, [object, format, out]) => getData(ole, 'gen', object, format, out),
  602: (ole, [object, format, handle]) => genSetData(ole, object, format, handle),
  603: (ole, [object, stream]) => saveToStream(ole, 'gen', object, stream),
  604: (ole, [object, client, doc, name, out]) => clone(ole, 'gen', object, client, doc, name, out),
  605: (ole, [a, b]) => (kindOf(ole, b) === 'gen' ? equal(ole, 'gen', a, b) : OLE_ERROR_NOT_EQUAL),
  606: (ole, [object]) => copyToClipboard(ole, 'gen', object),
  608: (ole, [object, rect]) => queryBounds(ole, 'gen', object, rect),
  609: () => OLE_ERROR_GENERIC,
  610: (ole, [object, format]) => enumFormat(ole, 'gen', object, format),
  611: (ole, [object, handle, client, release]) =>
    changeData(ole, 'gen', object, handle, client, release),
  910: (ole, [object, buffer, count]) => queryName(ole, object, buffer, count),
  911: (ole, [object, name]) => rename(ole, object, name),
  912: (ole, [object, out]) => queryType(ole, object, out),
  913: (ole, [object, out]) =>
    kindOf(ole, object) === 'le' || kindOf(ole, object) === 'pb'
      ? leQuerySize(ole, object, out)
      : querySize(ole, kindOf(ole, object) ?? 'gen', object, out),
  ...LE_METHODS,
  ...PB_METHODS,
};

/** A method of WinBox's by its ordinal, called with its arguments. */
export async function callOwnMethod(ole: Ole, ordinal: number, args: number[]): Promise<number> {
  const implementation = METHOD_IMPLEMENTATIONS[ordinal];

  return implementation ? await implementation(ole, args) : 0;
}

/** `MFCALLBACKFUNC` (102). */
export { mfCallback };
