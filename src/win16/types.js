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
        switch (type) {
            case BOOL:
            case BYTE:
            case UBYTE:
                return 1;

            case INT:
            case UINT:
            case HLOCAL:
            case HGLOBAL:
            case NEARPTR:
            case LPCSTR:
                return 2;

            case DWORD:
            case HWND:
                return 4;

            default:
                throw Error("unknown type");
        }
    }

    static signed(type) {
        switch (type) {
            case BYTE:
            case INT:
                return true;

            case BOOL:
            case UBYTE:
            case UINT:
            case HLOCAL:
            case HGLOBAL:
            case NEARPTR:
            case LPCSTR:
            case DWORD:
            case HWND:
                return false;

            default:
                throw Error("unknown type");
        }
    }
}

Types.BYTE = BYTE;
Types.UBYTE = UBYTE;
Types.INT = INT;
Types.UINT = UINT;
Types.HLOCAL = HLOCAL;
Types.HWND = HWND;
Types.NEARPTR = NEARPTR;
Types.LPCSTR = LPCSTR;
Types.BOOL = BOOL;
Types.DWORD = DWORD;
Types.HGLOBAL = HGLOBAL;

export default Types;
