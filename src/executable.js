"use strict";

import { Stream } from "./stream.js";
import { Util } from "./util.js";

/**
 * This class represents a PE executable.
 *
 * There can be resources within the executable, annoyingly, which we can pull
 * out when we need to do so.
 */
export class Executable {
    /**
     * Constructs an executable wrapper from the given executable data.
     *
     * @param {TypedArray} stream - The bytes that make up the executable.
     * @param {Object} options - A set of options.
     */
    constructor(name, path, stream, options = {}) {
        this._name = name;
        this._path = path;
        this._stream = stream;
    }

    get name() {
        return this._name;
    }

    get path() {
        return this._path;
    }

    /**
     * Returns the executable specification being followed.
     *
     * @return {Executable.TYPES} The executable type.
     */
    get type() {
        if (this._view.getUint16(this.headerOffset, true) == 0x454e) {
            return Executable.TYPES.NE;
        }
        else if (this._view.getUint16(this.headerOffset, true) == 0x454c) {
            return Executable.TYPES.LE;
        }
        else if (this._view.getUint32(this.headerOffset, true) == 0x00004550) {
            return Executable.TYPES.PE;
        }

        return Executable.TYPES.MZ;
    }

    /**
     * Returns the expected system this executable was designed for.
     */
    get system() {
        return this.neHeader.targetOperatingSystem;
    }

    get mzHeader() {
        if (!this._mzHeader) {
            this._mzHeader = Util.readStructure(this._view, Executable.MZ, 0, true)
        }

        return this._mzHeader;
    }

    get neHeader() {
        if (!this._neHeader) {
            this._neHeader = Util.readStructure(this._view, Executable.NE, this.headerOffset, true)
        }

        return this._neHeader;
    }

    get peHeader() {
        if (!this._peHeader) {
            this._peHeader = Util.readStructure(this._view, Executable.PE, this.headerOffset, true)
        }

        return this._peHeader;
    }

    get peOptionalHeader() {
        if (!this._peOptionalHeader) {
            this._peOptionalHeader = Util.readStructure(this._view, Executable.PEOptional, this.peHeaderOffset + 20, true)
        }

        return this._peOptionalHeader;
    }

    get stream() {
        return this._stream;
    }

    get magic() {
        return this.mzHeader.e_magic;
    }

    get headerOffset() {
        return this.mzHeader.e_lfanew;
    }

    get machine() {
        return this.peHeader.Machine;
    }

    get sections() {
        let offset = this.headerOffset + 20;
    }

    get entryPoints() {
        if (!this._entryPoints) {
            let offset = this.headerOffset + this.neHeader.entryTableOffset;
            let last = offset + this.neHeader.entryTableLength;

            // It is 1-based index, so we push a nonsense entrypoint to the list.
            let ret = [{}];

            // Keep track of which ordinal we are on
            let ordinal = 1;

            while (offset < last) {
                let entryPoint = {};

                // Read entry point bundle header
                // The first byte is the number of points in the bundle
                let bundleSize = this._view.getUint8(offset);
                offset++;

                // Get the segment index or some metadata describing the
                // segment for this bundle.
                let segment = this._view.getUint8(offset);
                offset++;

                if (segment == 0) {
                    // Empty bundle (skipped ordinals)
                    console.log("skipping", bundleSize);
                    ordinal += bundleSize;
                    for (let bi = 0; bi < bundleSize; bi++) {
                        ret.push({});
                    }
                    continue;
                }

                console.log("reading", bundleSize);
                for (var bi = 0; bi < bundleSize; bi++) {
                    if (segment == 0xff) {
                        // This is a movable segment.

                        // The next six bytes tells you the rest of the information
                        let flags = this._view.getUint8(offset);
                        offset++;

                        // The next two bytes are an 'int 3fh' instruction.
                        // It is weird!
                        offset+=2;

                        // A segment number
                        let segmentNumber = this._view.getUint8(offset);
                        offset++;

                        // A segment offset
                        let segmentOffset = this._view.getUint16(offset, true);
                        offset += 2;

                        entryPoint = {
                            movable: true,
                            segment: segmentNumber,
                            offset: segmentOffset,
                            exported: (flags & 0x1) != 0,
                            flags: flags,
                            ordinal: ordinal
                        };
                    }
                    else if (segment == 0xfe) {
                        // This is a constant and not a segment, apparently?
                        console.log("WHOA!! A constant entry point???");
                    }
                    else {
                        // segment is specifying the exact fixed segment

                        // The next three bytes tells you the rest of the information
                        let flags = this._view.getUint8(offset);
                        offset++;

                        // A segment offset
                        let segmentOffset = this._view.getUint16(offset, true);
                        offset += 2;

                        entryPoint = {
                            fixed: true,
                            segment: segment,
                            offset: segmentOffset,
                            exported: (flags & 0x1) != 0,
                            flags: flags,
                            ordinal: ordinal
                        };
                    }

                    ret.push(entryPoint);
                    ordinal++;
                }
            }

            this._entryPoints = ret;
        }

        return this._entryPoints;
    }

    get resources() {
        if (!this._resources) {
            let ret = [];

            if (this.type == Executable.TYPES.NE) {
                let startingOffset = this.neHeader.resourceTableOffset;
                startingOffset += this.headerOffset;

                let offset = startingOffset;
                let last = this.headerOffset + this.neHeader.residentNamesOffset;

                let shift = this._view.getUint16(offset, true);
                offset += 2;

                let limit = 0;
                while (offset < last && limit <= 10) {
                    limit++;

                    let resourceType = Util.readStructure(this._view, Executable.NEResourceType, offset, true);

                    if (resourceType.id == 0x0) {
                        break;
                    }
                    else if (resourceType.id < 0x8000) {
                        let subOffset = startingOffset + resourceType.id;
                        let length = this._view.getUint8(subOffset);
                        resourceType.id = Util.readString(this._view, subOffset + 1, length);
                    }

                    offset += 8;

                    resourceType.entries = [];

                    for (var i = 0; i < resourceType.number; i++) {
                        let resource = Util.readStructure(this._view, Executable.NEResource, offset, true);

                        if (resource.id < 0x8000) {
                            let subOffset = startingOffset + resource.id;
                            let length = this._view.getUint8(subOffset);
                            resource.id = Util.readString(this._view, subOffset + 1, length);
                        }

                        resource.offset <<= shift;
                        resource.length <<= shift;

                        resourceType.entries.push(resource);

                        offset += 12;
                    }

                    ret.push(resourceType);
                }
            }

            this._resources = ret;
        }

        return this._resources;
    }

    /**
     * Parses headers and ensures properties are loaded and available.
     */
    async parse() {
        // Get a view containing the headers
        let buffer = await this._stream.read(0, 1000);
        this._view = new DataView(buffer);

        // Ensure the executable is proper
        if (this.magic != Executable.TYPES.MZ) {
            throw new Error("magic number is invalid");
        }

        // Ensure we have enough for the header
        if (this.headerOffset + 200 >= buffer.byteLength) {
            buffer = await this._stream.read(0, this.headerOffset + 200);
            this._view = new DataView(buffer);
        }

        // Parse the main header and make sure our view is big enough

        // Determine the size of the resource table
        let resourceMax = this.headerOffset + this.neHeader.residentNamesOffset;

        // Determine the size of the entrypoint table
        let entryPointMax = this.headerOffset + this.neHeader.entryTableOffset;
        entryPointMax += this.neHeader.entryTableLength;

        // Determine the byte range we need to have in our view
        let max = Math.max(resourceMax, entryPointMax);

        // Re-download.
        // This view should be able to read all metadata.
        buffer = await this._stream.read(0, max);
        this._view = new DataView(buffer);
    }

    /**
     * Reads resource data from the executable.
     */
    async readResource(resourceEntry) {
        return await this._stream.read(resourceEntry.offset, resourceEntry.length);
    }
}

/**
 * The executable type, which helps specifies the system target.
 *
 * @typedef {number} Executable.TYPES
 * @property {number} NE - An 'NE' executable.
 * @property {number} LE - An 'LE' executable.
 * @property {number} PE - A 'PE' executable.
 * @property {number} MZ - An 'MZ' executable.
 */
Executable.TYPES = {
    NE: 0x454e,
    LE: 0x454c,
    PE: 0x4550,
    MZ: 0x5a4d,
};

/**
 * The architecture target.
 *
 * @typedef {number} Executable.MACHINES
 * @property {number} Intel_i860 - An Intel i860 machine target.
 * @property {number} Intel_i386 - An Intel i386 machine target.
 * @property {number} MIPS_R3000 - A MIPS R3000 machine target.
 * @property {number} MIPS_R4000 - A MIPS R4000 machine target.
 * @property {number} DEC_Alpha_AXP - An DEC Alpha machine target.
 */
Executable.MACHINES = {
    Intel_i860:    0x14d,
    Intel_i386:    0x14c,
    MIPS_R3000:    0x162,
    MIPS_R4000:    0x166,
    DEC_Alpha_AXP: 0x183,
};

/**
 * The intended system environment.
 *
 * @typedef {number} Executable.SYSTEMS
 * @property {number} Unknown - Unknown system.
 * @property {number} OS2 - OS/2.
 * @property {number} Windows - Windows 16-bit.
 * @property {number} EuropeanDOS4 - European DOS.
 * @property {number} Windows386 - Windows 32-bit.
 * @property {number} BOSS - BOSS.
 */
Executable.SYSTEMS = {
    Unknown:      0,
    OS2:          1,
    Windows:      2, // win16
    EuropeanDOS4: 3,
    Windows386:   4, // win32
    BOSS:         5,
};

/**
 * The offsets for the MZ DOS executable header.
 *
 * @typedef {number} Executable.MZ
 */
Executable.MZ = {
    e_magic:    [0,   2], // Magic number
    e_cblp:     [2,   2], // Bytes on last page of file
    e_cp:       [4,   2], // Pages in file
    e_crlc:     [6,   2], // Relocations
    e_cparhdr:  [8,   2], // Size of header in paragraphs
    e_minalloc: [10,  2], // Minimum extra paragraphs needed
    e_maxalloc: [12,  2], // Maximum extra paragraphs needed
    e_ss:       [14,  2], // Initial (relative) SS value
    e_sp:       [16,  2], // Initial SP value
    e_csum:     [18,  2], // Checksum
    e_ip:       [20,  2], // Initial IP value
    e_cs:       [22,  2], // Initial (relative) CS value
    e_lfarlc:   [24,  2], // File address of relocation table
    e_ovno:     [26,  2], // Overlay number
    e_res:      [28,  2], // Reserved words (4 shorts)
    e_oemid:    [36,  2], // OEM identifier (for e_oeminfo)
    e_oeminfo:  [38,  2], // OEM information; e_oemid specific
    e_res2:     [40,  2], // Reserved words (10 shorts)
    e_lfanew:   [60, -4], // File address of new exe header
};

// https://www.fileformat.info/format/exe/corion-ne.htm
// https://wiki.osdev.org/NE

/**
 * The structure of an NE executable header.
 *
 * Several of the fields are such liars. The resource table entry count/size is
 * complete bogus. You get the size of the resource table by subtracting the
 * offset of the resident names table from the resource table offset since the
 * former table follows the latter.
 *
 * Some documentation says the imported names are null-terminated, yet that's
 * not always true. The length is prepended to the strings like every other
 * table in this horrifying file format.
 *
 * @typedef {number} Executable.NE
 */
Executable.NE = {
    magic:                  [0,  2],
    linkerMajorVersion:     [2,  1],
    linkerMinorVersion:     [3,  1],
    entryTableOffset:       [4,  2],
    entryTableLength:       [6,  2],
    crc:                    [8,  4],
    flags:                  [12, 2],
    autoDataSegmentIndex:   [14, 2],
    initialLocalHeapSize:   [16, 2],
    initialStackSize:       [18, 2],
    entryPointIP:           [20, 2], // (CS:IP)
    entryPointCS:           [22, 2],
    initialStackPointerSP:  [24, 2], // (SS:SP)
    initialStackPointerSS:  [26, 2],
    segmentCount:           [28, 2],
    moduleReferenceCount:   [30, 2],
    nonresidentNamesSize:   [32, 2], // bytes
    segmentTableOffset:     [34, 2],
    resourceTableOffset:    [36, 2],
    residentNamesOffset:    [38, 2],
    moduleReferenceOffset:  [40, 2],
    importedNamesOffset:    [42, 2], // array of strings terminated with "\0" <- LIES
    nonresidentNamesOffset: [44, 4],
    entryPointIndex:        [48, 2], // entry table for movable entry point
    pageSize:               [50, 2], // n in 2^n. 0 is equal to 9 (512 bytes)
    resourceTableSize:      [52, 2], // Number of resource entries <- LIES, always 0
    targetOperatingSystem:  [54, 1],
    OS2Flags:               [55, 1],
    returnThunksOffset:     [56, 2], // Nobody knows what this is
    segmentThunksOffset:    [58, 2], // Who even knows
    minimumCodeSwapArea:    [60, 2],
    expectedWindowsVersion: [62, 2], // Minor version first
};

// NE Resources have an alignment shift entry (2 bytes) that all offsets are
// shifted by when calculating them afterward. This shift entry is followed
// by several resource type headers which themselves have multiple resource
// entries.

/**
 * The structure of an NE resource table header.
 *
 * @typedef {number} Executable.NEResourceType
 */
Executable.NEResourceType = {
    id:       [0, 2], // This is an integer if MSB is set, otherwise an offset
                      // relative to the beginning of the resource table to a
                      // string
    number:   [2, 2], // number of resources of this type
    reserved: [4, 4],
};

/**
 * The structure of an NE resource table entry.
 *
 * @typedef {number} Executable.NEResource
 */
Executable.NEResource = {
    offset:   [0, 2], // Relative to the shift specified before the table.
    length:   [2, 2], // In bytes
    flags:    [4, 2], // 10h - movable, 20h - shared, 40h - preloaded
    id:       [6, 2], // if MSB is set, it is an integer, otherwise an offset
                      // relative to the beginning of the resource table to a
                      // string
    reserved: [8, 4],
};

/**
 * The types of possible resources within the executable.
 *
 * @typedef {number} Executable.RESOURCES
 */
Executable.RESOURCES = {
    Accelerator:    0x8009,
    AnimatedCursor: 0x8015,
    AnimatedIcon:   0x8016,
    Bitmap:         0x8002,
    Cursor:         0x8001,
    Dialog:         0x8005,
    Font:           0x8008,
    FontDirectory:  0x8007,
    GroupCursor:    0x800c,
    GroupIcon:      0x800e,
    HTML:           0x8017,
    Icon:           0x8003,
    Manifest:       0x8018,
    Menu:           0x8004,
    MessageTable:   0x800b,
    PlugAndPlay:    0x8013,
    RawData:        0x800a, // RC_DATA
    StringTable:    0x8006,
    Version:        0x8010,
    VXD:            0x8014,
};

// https://docs.microsoft.com/en-us/previous-versions/ms809762(v=msdn.10)

/**
 * The offsets for the PE executable header.
 *
 * The naming conventions are the same as the windows headers.
 *
 * @typedef {number} Executable.PE
 */
Executable.PE = {
    Magic:                [0,  4], // PE\0\0
    Machine:              [4,  2], // Intended CPU
    NumberOfSections:     [6,  2], // Number of sections in file
    TimeDateStamp:        [8,  4], // Seconds since December 31st, 1969, 4pm
    PointerToSymbolTable: [12, 4], // Pointer to COFF table
    NumberOfSymbols:      [16, 4], // The number of symbols in the COFF table
    SizeOfOptionalHeader: [20, 2], // The size of the Optional header
    Characteristics:      [22, 2], // Flags
};

// RVA - Relative Virtual Address - Just fancy talk for offset from beginning
//                                  of the executable file itself, not where
//                                  it is linked/loaded.

/**
 * The offsets for the PE optional header.
 *
 * The naming conventions are the same as the windows headers.
 *
 * @typedef {number} Executable.PEOptional
 */
Executable.PEOptional = {
    // Standard Fields
    Magic:                       [0,  2], // The MS docs are unsure. haha.
    MajorLinkerVersion:          [2,  1], // Linker major version
    MinorLinkerVersion:          [3,  1], // Linker minor version
    SizeOfCode:                  [4,  4], // .text sections summed up
    SizeOfInitializedData:       [8,  4],
    SizeOfUninitializedData:     [12, 4],
    AddressOfEntryPoint:         [18, 4], // RVA address where execution starts
    BaseOfCode:                  [22, 4], // RVA address of .text
    BaseOfData:                  [26, 4], // RVA address of .data

    // NT Additional Fields
    ImageBase:                   [30, 4],
    SectionAlignment:            [34, 4],
    FileAlignment:               [38, 4],
    MajorOperatingSystemVersion: [42, 2], // OS major version requirement
    MinorOperatingSystemVersion: [44, 2], // OS minor version requirement
    MajorImageVersion:           [46, 2],
    MinorImageVersion:           [48, 2],
    MajorSubsystemVersion:       [50, 2], // More specific version requirement
    MinorSubsystemVersion:       [52, 2], // Ditto. Specifies the Win version.
    Reserved1:                   [54, 4],
    SizeOfImage:                 [58, 4],
    SizeOfHeaders:               [62, 4],
    CheckSum:                    [66, 4],
    Subsystem:                   [70, 2],
    DllCharacteristics:          [72, 2],
    SizeOfStackReserve:          [74, 4],
    SizeOfStackCommit:           [78, 4],
    SizeOfHeapReserve:           [82, 4],
    SizeOfHeapCommit:            [86, 4],
    LoaderFlags:                 [90, 4],
    NumberOfRvaAndSizes:         [94, 4],
};

/**
 * The structure of a PE executable section.
 *
 * @typedef {number} Executable.PESection
 */
Executable.PESection = {
    Name:                  [0,  "8"],
    SizeOrPhysicalAddress: [8,  4],
    VirtualAddress:        [12, 4],
    SizeOfRawData:         [16, 4],
    PointerToRawData:      [20, 4],
    PointerToRelocations:  [24, 4],
    PointerToLinenumbers:  [28, 4],
    NumberOfRelocations:   [32, 2],
    NumberOfLinenumbers:   [34, 2],
    Characteristics:       [36, 4],
};

export default Executable;
