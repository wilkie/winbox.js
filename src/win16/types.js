"use strict";

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
export var FARPTR = 14;

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

export var HANDLE = 11;
export var HMENU = 12;
export var HINSTANCE = 13;
export var HBRUSH = 20;
export var HICON = 21;
export var HCURSOR = 22;
export var WNDPROC = 23;

export var WPARAM = 15;
export var LPARAM = 16;

export var LRESULT = 24;
export var HDC = 25;

/**
 * Contains the various types used throughout the API.
 */
export class Types {
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
            case HCURSOR:
            case HICON:
            case HMENU:
            case HDC:
            case HANDLE:
            case HGLOBAL:
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
                return 4;

            default:
                throw Error("unknown type");
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
            case HCURSOR:
            case HICON:
            case WNDPROC:
            case HMENU:
            case HDC:
            case HANDLE:
            case HGLOBAL:
            case NEARPTR:
            case FARPTR:
            case WPARAM:
            case LPARAM:
            case LPCSTR:
            case LRESULT:
            case DWORD:
            case HWND:
                return false;

            default:
                throw Error("unknown type");
        }
    }
}

/**
 * This wraps aligned structs.
 */
export class Struct {
    constructor(items) {
        this._items = items;
        this._data = new Array(items.length);
        this._offsets = new Array(items.length);
        this._memory = null;
        this._offset = null;
        this._segment = null;

        // For each one, define a getter for it
        this._items.forEach( (item, i) => {
            this._data[i] = 0;
            if (item[1].prototype instanceof Struct) {
                this._data[i] = new item[1];
            }
            this._offsets[i] = 0;

            Object.defineProperty(this, item[0], {
                get: () => {
                    return this._data[i];
                },
                set: (value) => {
                    this._data[i] = value;
                    
                    if (this._memory) {
                        this.storeItemToMemory(i, this._memory,
                                                  this._segment,
                                                  this._offsets[i]);
                    }
                }
            });
        });
    }

    get structItems() {
        return this._items;
    }

    /**
     * Stores all items to memory.
     */
    storeToMemory(memory, segment, offset) {
        let size = 0;
        this._items.forEach( (_, i) => {
            let itemSize = this.storeItemToMemory(i, memory, segment, offset)
            size += itemSize;
            offset += offset;
        });
        return size;
    }

    storeItemToMemory(index, memory, segment, offset) {
        // For our sake, some aliases to read from the given memory.
        let write8 = memory.write8.bind(memory);
        let write16 = memory.write16.bind(memory);
        let size = 0;

        // Get item details
        let item = this._items[index];

        // Gather the type for this item
        let argType = item[1];

        // The current value
        let value = this._data[index];

        // And its size
        let itemSize = Types.sizeof(argType);

        if (argType.prototype instanceof Struct) {
            // An internal struct
            let innerSize = value.storeToMemory(memory, segment, offset);
            offset += innerSize;
            size += innerSize;
        }
        else if (itemSize == 1) {
            write8(segment, offset, value);

            // Word alignment should mean that we move to the next word
            offset += 2;
            size += 2;
        }
        else if (itemSize == 2) {
            write16(segment, offset, value);

            offset += 2;
            size += 2;
        }
        else if (itemSize == 4) {
            if (argType == Types.LPCSTR) {
                // Pointers... don't change... maybe
                // But we read them so we can write to memory
                let lo = memory.read16(segment, offset);
                let hi = memory.read16(segment, offset + 2);

                // Write string at [ret-hi]:[ret-lo]
                if (hi == 0 && lo == 0) {
                    // null string
                    return null;
                }

                memory.writeCString(hi >> 3, lo, value);
            }
            else {
                // Write the value
                write16(segment, offset + 2, (value >> 16) & 0xffff);
                write16(segment, offset, value & 0xffff);
            }

            offset += 4;
            size += 4;
        }
    }

    loadFromMemory(memory, segment, offset) {
        // For our sake, some aliases to read from the given memory.
        let read8 = memory.read8.bind(memory);
        let readSigned8 = memory.readSigned8.bind(memory);
        let read16 = memory.read16.bind(memory);
        let readSigned16 = memory.readSigned16.bind(memory);
        let size = 0;
        this._memory = memory;
        this._segment = segment;

        this._items.forEach( (item, i) => {
            // Gather the type for this item
            let argType = item[1];

            // And its size
            let size = Types.sizeof(argType);

            // Determine the value from memory
            let value = 0;

            // Retain the offset
            this._offsets[i] = offset;

            if (argType.prototype instanceof Struct) {
                // An internal struct
                value = new argType();
                let innerSize = value.loadFromMemory(memory, segment, offset);
                offset += innerSize;
                size += innerSize;
            }
            else if (Types.sizeof(argType) == 1) {
                if (Types.signed(argType)) {
                    value = readSigned8(segment, offset);
                }
                else {
                    value = read8(segment, offset);
                }

                // Word alignment should mean that we move to the next word
                offset += 2;
                size += 2;
            }
            else if (Types.sizeof(argType) == 2) {
                if (Types.signed(argType)) {
                    value = readSigned16(segment, offset);
                }
                else {
                    value = read16(segment, offset);
                }

                offset += 2;
                size += 2;
            }
            else if (Types.sizeof(argType) == 4) {
                let lo = read16(segment, offset);
                let hi = read16(segment, offset + 2);

                offset += 4;
                size += 4;

                if (argType == Types.LPCSTR) {
                    // Read string at [ret-hi]:[ret-lo]
                    if (hi == 0 && lo == 0) {
                        // null string
                        return null;
                    }

                    value = memory.readCString(hi >> 3, lo);
                }
                else {
                    value = (hi << 16) | (lo & 0xffff);
                }
            }

            // Assign the value
            this._data[i] = value;
        });
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
Types.HINSTANCE = HINSTANCE;
Types.NEARPTR = NEARPTR;
Types.LPCSTR = LPCSTR;
Types.BOOL = BOOL;
Types.DWORD = DWORD;
Types.HGLOBAL = HGLOBAL;
Types.WPARAM = WPARAM;
Types.LPARAM = LPARAM;
Types.LONG = LONG;
Types.ULONG = ULONG;
Types.HBRUSH = HBRUSH;
Types.HICON = HICON;
Types.HCURSOR = HCURSOR;
Types.WNDPROC = WNDPROC;
Types.LRESULT = LRESULT;

export default Types;
