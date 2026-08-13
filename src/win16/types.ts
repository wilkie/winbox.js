'use strict';

/**
 * A single byte integer with 2's complement signed encoding.
 *
 * @static
 * @typedef {number} BYTE
 * @memberof Types
 */
export var BYTE = 0;

/**
 * A single byte unsigned integer.
 *
 * @static
 * @typedef {number} UBYTE
 * @memberof Types
 */
export var UBYTE = 1;

/**
 * A 16-bit integer with 2's complement signed encoding.
 *
 * @static
 * @typedef {number} INT
 * @memberof Types
 */
export var INT = 2;

/**
 * A 16-bit unsigned integer.
 *
 * @static
 * @typedef {number} UINT
 * @memberof Types
 */
export var UINT = 3;

/**
 * A 32-bit integer with 2's complement signed encoding.
 *
 * @static
 * @typedef {number} LONG
 * @memberof Types
 */
export var LONG = 17;

/**
 * A 32-bit unsigned integer.
 *
 * @static
 * @typedef {number} ULONG
 * @memberof Types
 */
export var ULONG = 18;

/**
 * A 16-bit unsigned integer used as an atom handle.
 *
 * @static
 * @typedef {number} ATOM
 * @memberof Types
 */
export var ATOM = 19;

/**
 * A 16-bit pointer to a local allocation.
 *
 * @static
 * @typedef {number} HLOCAL
 * @memberof Types
 */
export var HLOCAL = 4;

/**
 * A 16-bit pointer to a memory offset.
 *
 * @static
 * @typedef {number} NEARPTR
 * @memberof Types
 */
export var NEARPTR = 5;

/**
 * A 32-bit pointer to memory.
 *
 * @static
 * @typedef {number} FARPTR
 * @memberof Types
 */
export var FARPTR = 40;

/**
 * A 16-bit pointer to a C-string.
 *
 * @static
 * @typedef {number} LPCSTR
 * @memberof Types
 */
export var LPCSTR = 10;

/**
 * An 8-bit integer that reflects a boolean value.
 *
 * Typically, a non-zero value indicates true and a zero indicates false.
 *
 * @static
 * @typedef {bool} BOOL
 * @memberof Types
 */
export var BOOL = 6;

/**
 * A 32-bit unsigned integer.
 *
 * @static
 * @typedef {number} DWORD
 * @memberof Types
 */
export var DWORD = 7;

/**
 * A 16-bit global handle.
 *
 * @static
 * @typedef {number} HGLOBAL
 * @memberof Types
 */
export var HGLOBAL = 8;

export var HWND = 9;

export var HGDIOBJ = 20;
export var HBRUSH = 21;
export var HPEN = 22;
export var HCURSOR = 23;
export var WNDPROC = 24;
export var HICON = 25;
export var HRGN = 26;
export var HBITMAP = 27;
export var HACCEL = 28;
export var HINSTANCE = 29;
export var HANDLE = 30;
export var HMENU = 31;

export var WPARAM = 15;
export var LPARAM = 16;

export var LRESULT = 40;
export var COLORREF = 41;

export var HDC = 50;

export var VARIADIC = 100;

export var CHARARRAY = 0x8000000;
export var BYTEARRAY = 0x10000000;
export var INTARRAY = 0x20000000;
export var UINTARRAY = 0x30000000;
export var DWORDARRAY = 0x40000000;

/**
 * A 16-bit file handle.
 *
 * @static
 * @typedef {number} HFILE
 * @memberof Types
 */
export var HFILE = 60;

/**
 * Contains the various types used throughout the API.
 */
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
    if (type instanceof Array) {
      // This is a far pointer
      return 4;
    }

    if (type.prototype instanceof Struct) {
      // This is also a far pointer
      return 4;
    }

    switch (type) {
      case BOOL:
      case BYTE:
      case UBYTE:
        return 1;

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
export class Struct {
  declare _data: any;
  declare _items: any;
  declare _memory: any;
  declare _offset: any;
  declare _offsets: any;
  declare _segment: any;
  declare _size: any;
  constructor(items) {
    this._items = items;
    this._data = new Array(items.length);
    this._offsets = new Array(items.length);
    this._memory = null;
    this._offset = null;
    this._segment = null;
    this._size = 0;

    // For each one, define a getter for it
    this._items.forEach((item, i) => {
      this._data[i] = 0;
      if (item[1].prototype instanceof Struct) {
        this._data[i] = new item[1]();
        this._size += this._data[i].structSize;
      } else {
        this._size += Types.sizeof(item[1]);
      }
      this._offsets[i] = 0;

      Object.defineProperty(this, item[0], {
        get: () => {
          return this._data[i];
        },
        set: (value) => {
          this._data[i] = value;

          if (this._memory) {
            this.storeItemToMemory(i, this._memory, this._segment, this._offsets[i]);
          }
        },
      });
    });
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
    // For our sake, some aliases to read from the given memory.
    const write8 = memory.write8.bind(memory);
    const write16 = memory.write16.bind(memory);
    const write32 = memory.write32.bind(memory);
    let size = 0;

    // Get item details
    let item = this._items[index];

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
      const len = argType - UINTARRAY;
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
      if (item.length + 1 >= len) {
        item = item.substring(0, len - 1);
      }

      memory.writeCString((segment << 16) + offset, value);
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
    // For our sake, some aliases to read from the given memory.
    const read8 = memory.read8.bind(memory);
    const read32 = memory.read32.bind(memory);
    const readSigned8 = memory.readSigned8.bind(memory);
    const read16 = memory.read16.bind(memory);
    const readSigned16 = memory.readSigned16.bind(memory);
    let size = 0;
    this._memory = memory;
    this._segment = segment;

    this._items.forEach((item, i) => {
      // Gather the type for this item
      const argType = item[1];

      // Determine the value from memory
      let value: any = 0;

      // Retain the offset
      this._offsets[i] = offset;

      if (argType.prototype instanceof Struct) {
        // An internal struct
        value = new argType();
        const innerSize = value.loadFromMemory(memory, segment, offset);
        offset += innerSize;
        size += innerSize;
      } else if (argType >= DWORDARRAY) {
        // Read series of 32-bit words
        // The item is an array of numbers
        value = [];
        const len = argType - DWORDARRAY;
        for (let i = 0; i < len; i++) {
          value.push(read32((segment << 16) + offset));
          offset += 4;
          size += 4;
        }
      } else if (argType >= UINTARRAY) {
        // Read series of 16-bit words
        // The item is an array of numbers
        value = [];
        const len = argType - UINTARRAY;
        for (let i = 0; i < len; i++) {
          value.push(read16((segment << 16) + offset));
          offset += 2;
          size += 2;
        }
      } else if (argType >= INTARRAY) {
        // Read series of 16-bit words
        // The item is an array of numbers
        value = [];
        const len = argType - UINTARRAY;
        for (let i = 0; i < len; i++) {
          value.push(read16((segment << 16) + offset));
          offset += 2;
          size += 2;
        }
      } else if (argType >= BYTEARRAY) {
        // Read series of 8-bit words
        // The item is an array of numbers
        value = [];
        const len = argType - BYTEARRAY;
        for (let i = 0; i < len; i++) {
          value.push(read8((segment << 16) + offset));
          offset++;
          size++;
        }
      } else if (argType >= CHARARRAY) {
        // Read string.
        // The item is a string
        const len = argType - CHARARRAY;
        value = memory.readCString((segment << 16) + offset, len);
        size += len;
      } else if (Types.sizeof(argType) == 1) {
        if (Types.signed(argType)) {
          value = readSigned8((segment << 16) + offset);
        } else {
          value = read8((segment << 16) + offset);
        }

        // Byte packed (most of the time?)
        offset += 1;
        size += 1;
      } else if (Types.sizeof(argType) == 2) {
        if (Types.signed(argType)) {
          value = readSigned16((segment << 16) + offset);
        } else {
          value = read16((segment << 16) + offset);
        }

        offset += 2;
        size += 2;
      } else if (Types.sizeof(argType) == 4) {
        const lo = read16((segment << 16) + offset);
        const hi = read16((segment << 16) + offset + 2);

        offset += 4;
        size += 4;

        if (argType == Types.LPCSTR) {
          // Read string at [ret-hi]:[ret-lo]
          if (hi == 0 && lo == 0) {
            // null string
            return null;
          }

          value = memory.readCString(((hi >> 3) << 16) + lo);
        } else {
          value = (hi << 16) | (lo & 0xffff);
        }
      }

      // Assign the value
      this._data[i] = value;
    });

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
