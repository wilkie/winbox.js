'use strict';

/**
 * A single byte integer with 2's complement signed encoding.
 *
 * @static
 * @typedef {number} BYTE
 * @memberof Types
 */
export const BYTE = 0;

/**
 * A single byte unsigned integer.
 *
 * @static
 * @typedef {number} UBYTE
 * @memberof Types
 */
export const UBYTE = 1;

/**
 * A 16-bit integer with 2's complement signed encoding.
 *
 * @static
 * @typedef {number} INT
 * @memberof Types
 */
export const INT = 2;

/**
 * A 16-bit unsigned integer.
 *
 * @static
 * @typedef {number} UINT
 * @memberof Types
 */
export const UINT = 3;

/**
 * A 32-bit integer with 2's complement signed encoding.
 *
 * @static
 * @typedef {number} LONG
 * @memberof Types
 */
export const LONG = 17;

/**
 * A 32-bit unsigned integer.
 *
 * @static
 * @typedef {number} ULONG
 * @memberof Types
 */
export const ULONG = 18;

/**
 * A 16-bit unsigned integer used as an atom handle.
 *
 * @static
 * @typedef {number} ATOM
 * @memberof Types
 */
export const ATOM = 19;

/**
 * A 16-bit pointer to a local allocation.
 *
 * @static
 * @typedef {number} HLOCAL
 * @memberof Types
 */
export const HLOCAL = 4;

/**
 * A 16-bit pointer to a memory offset.
 *
 * @static
 * @typedef {number} NEARPTR
 * @memberof Types
 */
export const NEARPTR = 5;

/**
 * A 32-bit pointer to memory.
 *
 * @static
 * @typedef {number} FARPTR
 * @memberof Types
 */
export const FARPTR = 40;

/**
 * A 16-bit pointer to a C-string.
 *
 * @static
 * @typedef {number} LPCSTR
 * @memberof Types
 */
export const LPCSTR = 10;

/**
 * An 8-bit integer that reflects a boolean value.
 *
 * Typically, a non-zero value indicates true and a zero indicates false.
 *
 * @static
 * @typedef {bool} BOOL
 * @memberof Types
 */
export const BOOL = 6;

/**
 * A 32-bit unsigned integer.
 *
 * @static
 * @typedef {number} DWORD
 * @memberof Types
 */
export const DWORD = 7;

/**
 * A 16-bit global handle.
 *
 * @static
 * @typedef {number} HGLOBAL
 * @memberof Types
 */
export const HGLOBAL = 8;

export const HWND = 9;

export const HGDIOBJ = 20;
export const HBRUSH = 21;
export const HPEN = 22;
export const HCURSOR = 23;
export const WNDPROC = 24;
export const HICON = 25;
export const HRGN = 26;
export const HBITMAP = 27;
export const HACCEL = 28;
export const HINSTANCE = 29;
export const HANDLE = 30;
export const HMENU = 31;

export const WPARAM = 15;
export const LPARAM = 16;

export const LRESULT = 40;
export const COLORREF = 41;

export const HDC = 50;

export const VARIADIC = 100;

export const CHARARRAY = 0x8000000;
export const BYTEARRAY = 0x10000000;
export const INTARRAY = 0x20000000;
export const UINTARRAY = 0x30000000;
export const DWORDARRAY = 0x40000000;

/**
 * A 16-bit file handle.
 *
 * @static
 * @typedef {number} HFILE
 * @memberof Types
 */
export const HFILE = 60;

/**
 * Contains the various types used throughout the API.
 */
/** The sizes of the types that are numbers, as `sizeof` works them out. */
const SIZES = new Map<number, number>();

export class Types {
  declare static BOOL: any;
  declare static BYTE: any;
  declare static COLOREF: any;
  declare static DWORD: any;
  declare static HACCEL: any;
  declare static HANDLE: any;
  declare static HBITMAP: any;
  declare static HBRUSH: any;
  declare static HCURSOR: any;
  declare static HFILE: any;
  declare static HGDIOBJ: any;
  declare static HGLOBAL: any;
  declare static HICON: any;
  declare static HINSTANCE: any;
  declare static HLOCAL: any;
  declare static HMENU: any;
  declare static HPEN: any;
  declare static HRGN: any;
  declare static HWND: any;
  declare static INT: any;
  declare static LONG: any;
  declare static LPARAM: any;
  declare static LPCSTR: any;
  declare static LRESULT: any;
  declare static NEARPTR: any;
  declare static UBYTE: any;
  declare static UINT: any;
  declare static ULONG: any;
  declare static WNDPROC: any;
  declare static WPARAM: any;
  /**
   * Returns the size of the given type in bytes.
   *
   * @param {number} type - The type constant to query.
   *
   * @returns {number} The size in bytes.
   */
  static sizeof(type) {
    /* A number's size, once worked out, kept: asked for every field of
     * every structure and every argument of every call. */
    if (typeof type === 'number') {
      const known = SIZES.get(type);

      if (known !== undefined) {
        return known;
      }

      const size = Types.sizeOfNumbered(type);

      SIZES.set(type, size);

      return size;
    }

    return Types.sizeOfNumbered(type);
  }

  /** A type's size in bytes, worked out. See `sizeof`. */
  static sizeOfNumbered(type) {
    if (type instanceof Array) {
      // This is a far pointer
      return 4;
    }

    if (type.prototype instanceof Struct) {
      // This is also a far pointer
      return 4;
    }

    switch (type) {
      case BYTE:
      case UBYTE:
        return 1;

      /* `BOOL` is `int` in the Win16 headers, so it is two bytes wherever it
       * appears -- as an argument and as a struct field alike. Sizing it as
       * one byte put every `PAINTSTRUCT` field after `fErase` a byte out of
       * place, and masked a `BOOL` argument to its low eight bits.
       */
      case BOOL:
      case INT:
      case UINT:
      case ATOM:
      case HLOCAL:
      case HINSTANCE:
      case HBRUSH:
      case HPEN:
      case HGDIOBJ:
      case HRGN:
      case HCURSOR:
      case HICON:
      case HBITMAP:
      case HMENU:
      case HACCEL:
      case HDC:
      case HANDLE:
      case HGLOBAL:
      case HFILE:
      case NEARPTR:
      case WPARAM:
      case HWND:
        return 2;

      case DWORD:
      case LPCSTR:
      case FARPTR:
      case LPARAM:
      case LRESULT:
      case WNDPROC:
      case LONG:
      case ULONG:
      case COLORREF:
        return 4;

      default:
        // Array type
        if (type >= DWORDARRAY) {
          return (type - DWORDARRAY) * Types.sizeof(DWORD);
        } else if (type >= UINTARRAY) {
          return (type - UINTARRAY) * Types.sizeof(UINT);
        } else if (type >= INTARRAY) {
          return (type - INTARRAY) * Types.sizeof(INT);
        } else if (type >= BYTEARRAY) {
          return type - BYTEARRAY;
        } else if (type >= CHARARRAY) {
          return type - CHARARRAY;
        }

        throw Error('unknown type: ' + type);
    }
  }

  static signed(type) {
    if (type instanceof Array) {
      // Pointer value
      return false;
    }

    if (type.prototype instanceof Struct) {
      // Also a pointer value
      return false;
    }

    switch (type) {
      case BYTE:
      case INT:
      case LONG:
        return true;

      case BOOL:
      case UBYTE:
      case UINT:
      case ULONG:
      case ATOM:
      case HLOCAL:
      case HINSTANCE:
      case HBRUSH:
      case HPEN:
      case HGDIOBJ:
      case HRGN:
      case HCURSOR:
      case HICON:
      case HBITMAP:
      case WNDPROC:
      case HMENU:
      case HACCEL:
      case HDC:
      case HANDLE:
      case HGLOBAL:
      case HFILE:
      case NEARPTR:
      case FARPTR:
      case WPARAM:
      case LPARAM:
      case LPCSTR:
      case LRESULT:
      case DWORD:
      case HWND:
      case COLORREF:
        return false;

      default:
        if (type >= CHARARRAY) {
          return false;
        }

        throw Error('unknown type: ' + type);
    }
  }
}

/**
 * This wraps aligned structs.
 */
/** A field's getter and setter, for its place in a structure's items. */
function accessorsFor(i: number) {
  return {
    get(this: any) {
      return this._data[i];
    },
    set(this: any, value: any) {
      this._data[i] = value;

      if (this._memory) {
        this.storeItemToMemory(i, this._memory, this._segment, this._offsets[i]);
      }
    },
    configurable: true,
  };
}

const FIELDS = Symbol('fields');

/** Defines a structure class's accessors on it once; whether its fields are those. */
function fieldsOn(proto: any, items: any[], names: string) {
  if (Object.prototype.hasOwnProperty.call(proto, FIELDS)) {
    return proto[FIELDS] === names;
  }

  items.forEach((item, i) => {
    Object.defineProperty(proto, item[0], accessorsFor(i));
  });
  Object.defineProperty(proto, FIELDS, { value: names });

  return true;
}

/** How each field of a structure is read: see `layoutOf`. */
const FIELD_STRUCT = 0;
const FIELD_DWORDS = 1;
const FIELD_UINTS = 2;
const FIELD_INTS = 3;
const FIELD_BYTES = 4;
const FIELD_CHARS = 5;
const FIELD_BYTE = 6;
const FIELD_WORD = 7;
const FIELD_FOUR = 8;
const FIELD_NONE = 9;

type Layout = {
  /** The items it was worked out for. */
  items: any[];
  /** The field names, joined: what `fieldsOn` knows a class's fields by. */
  names: string;
  kinds: number[];
  /** For an array, its length; else the field's size. */
  lengths: number[];
  signed: boolean[];
  /** The fields' sizes but for nested structures, which size themselves. */
  size: number;
  /** Whether the class's accessors are these fields' (`fieldsOn`). */
  shared: boolean;
};

const LAYOUTS = new WeakMap<object, Layout>();

/**
 * How a structure's fields are read and written, worked out once for each
 * structure class -- a structure is made for every message a program
 * takes, and each field's type was asked again each time -- and again only
 * where the items given are not the ones it was worked out for. A plain
 * `Struct`, whose items vary, has its own each time.
 */
function layoutOf(proto: object, items: any[]): Layout {
  const known = proto !== Struct.prototype ? LAYOUTS.get(proto) : undefined;

  if (known && sameItems(known.items, items)) {
    return known;
  }

  const layout: Layout = {
    items,
    names: items.map((item) => item[0]).join(','),
    kinds: [],
    lengths: [],
    signed: [],
    size: 0,
    shared: false,
  };

  for (const [, type] of items) {
    let kind = FIELD_NONE;
    let length = 0;
    let signed = false;

    /* In the order the fields were always tested: an array's bound is above
     * every plain type's number. */
    if (type.prototype instanceof Struct) {
      kind = FIELD_STRUCT;
    } else if (type >= DWORDARRAY) {
      [kind, length] = [FIELD_DWORDS, type - DWORDARRAY];
    } else if (type >= UINTARRAY) {
      [kind, length] = [FIELD_UINTS, type - UINTARRAY];
    } else if (type >= INTARRAY) {
      [kind, length] = [FIELD_INTS, type - INTARRAY];
    } else if (type >= BYTEARRAY) {
      [kind, length] = [FIELD_BYTES, type - BYTEARRAY];
    } else if (type >= CHARARRAY) {
      [kind, length] = [FIELD_CHARS, type - CHARARRAY];
    } else {
      length = Types.sizeof(type);
      kind = length == 1 ? FIELD_BYTE : length == 2 ? FIELD_WORD : length == 4 ? FIELD_FOUR : kind;
      signed = length <= 2 && !!Types.signed(type);
    }

    if (kind !== FIELD_STRUCT) {
      layout.size += Types.sizeof(type);
    }

    layout.kinds.push(kind);
    layout.lengths.push(length);
    layout.signed.push(signed);
  }

  if (proto !== Struct.prototype) {
    layout.shared = fieldsOn(proto, items, layout.names);
    LAYOUTS.set(proto, layout);
  }

  return layout;
}

/** Whether two items lists name the same fields of the same types. */
function sameItems(a: any[], b: any[]) {
  if (a === b) {
    return true;
  }

  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i++) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) {
      return false;
    }
  }

  return true;
}

export class Struct {
  declare _data: any;
  declare _items: any;
  declare _layout: Layout;
  declare _memory: any;
  declare _offset: any;
  declare _offsets: any;
  declare _segment: any;
  declare _size: any;
  constructor(items) {
    this._items = items;
    this._memory = null;
    this._offset = null;
    this._segment = null;

    /* Each field's accessors, defined once on a structure's own class: a
     * structure made for every message taken -- millions, from a program
     * that polls -- defined them anew on each, and the time and the garbage
     * were a fifth of such a program's. A plain `Struct`, whose fields vary,
     * has them on itself. */
    const layout = layoutOf(new.target.prototype, items);
    const shared = layout.shared;
    const data: any[] = [];
    const offsets: number[] = [];
    let size = layout.size;

    this._layout = layout;

    for (let i = 0; i < items.length; i++) {
      offsets.push(0);

      if (layout.kinds[i] === FIELD_STRUCT) {
        const inner = new items[i][1]();

        data.push(inner);
        size += inner.structSize;
      } else {
        data.push(0);
      }

      if (!shared) {
        Object.defineProperty(this, items[i][0], accessorsFor(i));
      }
    }

    this._data = data;
    this._offsets = offsets;
    this._size = size;
  }

  get structSize() {
    return this._size;
  }

  get structItems() {
    return this._items;
  }

  /**
   * Stores all items to memory.
   */
  storeToMemory(memory, segment, offset) {
    let size = 0;
    this._items.forEach((_, i) => {
      const itemSize = this.storeItemToMemory(i, memory, segment, offset);
      size += itemSize;
      offset += itemSize;
    });
    return size;
  }

  storeItemToMemory(index, memory, segment, offset) {
    const write8 = (at: number, value: number) => memory.write8(at, value);
    const write16 = (at: number, value: number) => memory.write16(at, value);
    const write32 = (at: number, value: number) => memory.write32(at, value);
    let size = 0;

    // Get item details
    const item = this._items[index];

    // Gather the type for this item
    const argType = item[1];

    // The current value
    const value = this._data[index];

    // And its size
    const itemSize = Types.sizeof(argType);

    if (argType.prototype instanceof Struct) {
      // An internal struct
      const innerSize = value.storeToMemory(memory, segment, offset);
      size += innerSize;
    } else if (argType >= DWORDARRAY) {
      // Write series of 32-bit words
      // The item is an array of numbers
      const len = argType - DWORDARRAY;
      for (let i = 0; i < len; i++) {
        write32((segment << 16) + offset, value[i]);
        offset += 4;
        size += 4;
      }
    } else if (argType >= UINTARRAY) {
      // Write series of 16-bit words
      // The item is an array of numbers
      const len = argType - UINTARRAY;
      for (let i = 0; i < len; i++) {
        write16((segment << 16) + offset, value[i]);
        offset += 2;
        size += 2;
      }
    } else if (argType >= INTARRAY) {
      // Write series of 16-bit words
      // The item is an array of numbers
      const len = argType - INTARRAY;
      for (let i = 0; i < len; i++) {
        write16((segment << 16) + offset, value[i]);
        offset += 2;
        size += 2;
      }
    } else if (argType >= BYTEARRAY) {
      // Write series of 8-bit words
      // The item is an array of numbers
      const len = argType - BYTEARRAY;
      for (let i = 0; i < len; i++) {
        write8((segment << 16) + offset, value[i]);
        offset++;
        size++;
      }
    } else if (argType >= CHARARRAY) {
      // Write series of 8-bit words
      // The item is a string
      const len = argType - CHARARRAY;
      const text = value.length + 1 >= len ? value.substring(0, len - 1) : value;

      memory.writeCString((segment << 16) + offset, text);
      size += len;
    } else if (itemSize == 1) {
      write8((segment << 16) + offset, value);

      // Byte packed (most of the time?)
      size += 1;
    } else if (itemSize == 2) {
      write16((segment << 16) + offset, value);

      size += 2;
    } else if (itemSize == 4) {
      if (argType == Types.LPCSTR) {
        // Pointers... don't change... maybe
        // But we read them so we can write to memory
        const lo = memory.read16((segment << 16) + offset);
        const hi = memory.read16((segment << 16) + offset + 2);

        // Write string at [ret-hi]:[ret-lo]
        if (hi == 0 && lo == 0) {
          // null string
          return null;
        }

        memory.writeCString(((hi >> 3) << 16) + lo, value);
      } else {
        // Write the value
        write16((segment << 16) + offset, value & 0xffff);
        write16((segment << 16) + offset + 2, (value >> 16) & 0xffff);
      }

      size += 4;
    }

    return size;
  }

  loadFromMemory(memory, segment, offset) {
    const { kinds, lengths, signed } = this._layout;
    const items = this._items;
    let size = 0;
    this._memory = memory;
    this._segment = segment;

    for (let i = 0; i < items.length; i++) {
      const at = segment << 16;
      const length = lengths[i];

      // Determine the value from memory
      let value: any = 0;

      // Retain the offset
      this._offsets[i] = offset;

      switch (kinds[i]) {
        case FIELD_STRUCT: {
          // An internal struct
          value = new items[i][1]();
          const innerSize = value.loadFromMemory(memory, segment, offset);
          offset += innerSize;
          size += innerSize;
          break;
        }

        case FIELD_DWORDS:
          // Read series of 32-bit words
          value = [];
          for (let j = 0; j < length; j++) {
            value.push(memory.read32(at + offset));
            offset += 4;
            size += 4;
          }
          break;

        case FIELD_UINTS:
        case FIELD_INTS:
          // Read series of 16-bit words
          value = [];
          for (let j = 0; j < length; j++) {
            value.push(memory.read16(at + offset));
            offset += 2;
            size += 2;
          }
          break;

        case FIELD_BYTES:
          // Read series of 8-bit words
          value = [];
          for (let j = 0; j < length; j++) {
            value.push(memory.read8(at + offset));
            offset++;
            size++;
          }
          break;

        case FIELD_CHARS:
          // Read string. The offset is not moved past it, as it never was.
          value = memory.readCString(at + offset, length);
          size += length;
          break;

        case FIELD_BYTE:
          value = signed[i] ? memory.readSigned8(at + offset) : memory.read8(at + offset);

          // Byte packed (most of the time?)
          offset += 1;
          size += 1;
          break;

        case FIELD_WORD:
          value = signed[i] ? memory.readSigned16(at + offset) : memory.read16(at + offset);
          offset += 2;
          size += 2;
          break;

        case FIELD_FOUR: {
          const lo = memory.read16(at + offset);
          const hi = memory.read16(at + offset + 2);

          offset += 4;
          size += 4;

          if (items[i][1] == Types.LPCSTR) {
            // Read string at [ret-hi]:[ret-lo]
            if (hi == 0 && lo == 0) {
              // null string: the field keeps what it had
              continue;
            }

            /* A segment of 0 is `MAKEINTRESOURCE`: a resource's number, not a
             * string -- a class's menu named by its identifier. The arguments
             * of a call are read the same way. */
            value = hi == 0 ? lo : memory.readCString(((hi >> 3) << 16) + lo);
          } else {
            value = (hi << 16) | (lo & 0xffff);
          }
          break;
        }
      }

      // Assign the value
      this._data[i] = value;
    }

    return size;
  }
}

Types.BYTE = BYTE;
Types.UBYTE = UBYTE;
Types.INT = INT;
Types.UINT = UINT;
Types.HLOCAL = HLOCAL;
Types.HANDLE = HANDLE;
Types.HWND = HWND;
Types.HMENU = HMENU;
Types.HACCEL = HACCEL;
Types.HINSTANCE = HINSTANCE;
Types.NEARPTR = NEARPTR;
Types.LPCSTR = LPCSTR;
Types.BOOL = BOOL;
Types.DWORD = DWORD;
Types.HGLOBAL = HGLOBAL;
Types.HFILE = HFILE;
Types.WPARAM = WPARAM;
Types.LPARAM = LPARAM;
Types.LONG = LONG;
Types.ULONG = ULONG;
Types.HBRUSH = HBRUSH;
Types.HPEN = HPEN;
Types.HRGN = HRGN;
Types.HICON = HICON;
Types.HCURSOR = HCURSOR;
Types.HBITMAP = HBITMAP;
Types.WNDPROC = WNDPROC;
Types.LRESULT = LRESULT;
Types.COLOREF = COLORREF;
Types.HGDIOBJ = HGDIOBJ;

export default Types;
