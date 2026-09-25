'use strict';

/**
 * A dialog box template, as a resource holds one or a program builds one in
 * memory for `DialogBoxIndirect`: the dialog, then each control.
 *
 * The dialog: its style (a long), how many controls, its place and size in
 * dialog units (four words), its menu, its window class and its caption --
 * each a string, where a menu or class of a single zero is none and a menu of
 * 0FFh is followed by a resource number -- and, with `DS_SETFONT` in the
 * style, the font's size in points and its face.
 *
 * Each control: its place and size, its identifier, its style (a long), its
 * class -- a byte with its top bit set for one of USER's own, or a string --
 * its text -- a string, or 0FFh and a resource number, as an icon names its
 * image -- and a byte counting the bytes of creation data that follow.
 */

export const DS_SETFONT = 0x40;

/** USER's own classes, by the byte a template names them with. */
const CLASSES: Record<number, string> = {
  0x80: 'BUTTON',
  0x81: 'EDIT',
  0x82: 'STATIC',
  0x83: 'LISTBOX',
  0x84: 'SCROLLBAR',
  0x85: 'COMBOBOX',
};

export interface DialogItem {
  x: number;
  y: number;
  cx: number;
  cy: number;
  id: number;
  style: number;
  className: string;
  /** The control's text, or the number of the resource it names. */
  text: string | number;
  /** The creation data, handed to the control's `WM_CREATE`. */
  data: Uint8Array;
}

export interface DialogTemplate {
  style: number;
  x: number;
  y: number;
  cx: number;
  cy: number;
  menu: string | number | null;
  className: string | null;
  caption: string;
  font: { points: number; face: string } | null;
  items: DialogItem[];
}

/** Reads a template through `byte`, which answers the byte at an offset from its start. */
export function parseDialogTemplate(byte: (at: number) => number): DialogTemplate {
  let at = 0;

  const u8 = () => byte(at++);
  const u16 = () => {
    const value = byte(at) | (byte(at + 1) << 8);

    at += 2;
    return value;
  };
  const s16 = () => (u16() << 16) >> 16;
  const u32 = () => (u16() | (u16() << 16)) >>> 0;
  const text = () => {
    let out = '';

    for (let c = u8(); c !== 0; c = u8()) {
      out += String.fromCharCode(c);
    }

    return out;
  };

  /* A menu or a name: none, a resource number after 0FFh, or a string. */
  const nameOrNumber = () => {
    const first = byte(at);

    if (first === 0) {
      at++;
      return null;
    }

    if (first === 0xff) {
      at++;
      return u16();
    }

    return text();
  };

  const style = u32();
  const count = u8();
  const x = s16();
  const y = s16();
  const cx = s16();
  const cy = s16();
  const menu = nameOrNumber();
  const className = nameOrNumber();
  const caption = text();
  const font = style & DS_SETFONT ? { points: u16(), face: text() } : null;
  const items: DialogItem[] = [];

  for (let index = 0; index < count; index++) {
    const item = { x: s16(), y: s16(), cx: s16(), cy: s16(), id: u16(), style: u32() };
    const kind = byte(at);
    const itemClass = kind & 0x80 ? (at++, CLASSES[kind] ?? 'STATIC') : text();
    const itemText = byte(at) === 0xff ? (at++, u16()) : text();
    const size = u8();
    const data = new Uint8Array(size);

    for (let n = 0; n < size; n++) {
      data[n] = u8();
    }

    items.push({ ...item, className: itemClass, text: itemText, data });
  }

  return {
    style,
    x,
    y,
    cx,
    cy,
    menu,
    className: typeof className === 'string' ? className : null,
    caption,
    font,
    items,
  };
}
