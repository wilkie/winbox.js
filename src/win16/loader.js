"use strict";

import { Util } from '../util.js';

/**
 * Represents the operating system executable loader.
 *
 * This represents the loaded executable in memory as a module. Relocations
 * targetting this module (such as DLL usage) will be interpreted by this
 * class instance. That is, when mapping the segment and offset of an imported
 * procedure call to the place in memory the call is actually located.
 *
 * This loader is specifically targetting Win16 NE executables.
 */
export class Loader {
    /**
     * Creates a loader that will place the given executable into the given
     * memory.
     */
    constructor(executable, globalAllocator, options = {}) {
        this._globalAllocator = globalAllocator;
        this._stream = executable._stream;
        this._header = executable.neHeader;
        this._executable = executable;
        this._segments = [];
        this._isDLL = false;
        this._isApp = false;
        this._segmentMap = {};
    }

    async parse() {
        await this.parseHeaders();

        for (let i = 0; i < this.segments.length; i++) {
            let segment = this.segments[i];
            let view = new DataView(
                await this._stream.read(segment.offset, segment.length)
            );

            // Allocate a segment
            let segmentIndex = this._globalAllocator.find();

            // Retain knowledge about where the executable segment was loaded
            this._segmentMap[i + 1] = segmentIndex;

            console.log("loading segment", segmentIndex, "with", view.byteLength, "bytes");
            console.log("let's take a look", view.getUint8(0).toString(16));
            this._globalAllocator.map(segmentIndex, view);
        }
    }

    /**
     * Returns the proper name of this executable.
     */
    get name() {
        // The 'module name' is the first resident name.
        if (this.residentEntries.length > 0) {
            return this.residentEntries[0].name;
        }

        return this._executable.name.split('.')[0];
    }

    /**
     * Returns the proper name of this executable.
     */
    get description() {
        // The 'module description' is the first exported name.
        return this.nonResidentEntries[0].name;
    }

    get header() {
        return this._header;
    }

    get executable() {
        return this._executable;
    }

    /**
     * Returns the segments that are part of this executable.
     */
    get segments() {
        return this._segments;
    }

    /**
     * Returns the initial DS register value.
     *
     * @return {number} The SS register value.
     */
    get ds() {
        return this._DS;
    }

    /**
     * Returns the initial CS register value.
     *
     * @return {number} The CS register value.
     */
    get cs() {
        return this._CS;
    }

    /**
     * Returns the initial IP register value.
     *
     * @return {number} The IP register value.
     */
    get ip() {
        return this._IP;
    }

    /**
     * Returns the initial SS register value.
     *
     * @return {number} The SS register value.
     */
    get ss() {
        return this._SS;
    }

    /**
     * Returns the initial SP register value.
     *
     * @return {number} The SP register value.
     */
    get sp() {
        return this._SP;
    }

    /**
     * Parses the headers for information.
     */
    async parseHeaders() {
        let flags = this.header.flags;
        if (flags & 0x01) {
            // Flag bit 0: when set, the executable is SINGLEDATA.
            // This means it has a single data segment.
            // This generally means it is a dynamic-link library (DLL)
            this._isDLL = true;
        }

        if (flags & 0x02) {
            // Flag bit 1: when set, the executable is MULTIPLEDATA.
            // This means it has multiple data segments.
            // Therefore, it is a Windows application.
            this._isApp = true;
        }

        if (!(flags & 0x11)) {
            // If neither bit 0 nor 1 are set, the executable is NOAUTODATA.
            // It has no automatic data segment.
        }

        if (flags & (1 << 11)) {
            // When bit 11 is set, the first segment in the executable is the
            // code that loads the application.
            console.log("First segment loads the application.");
        }

        if (flags & (1 << 13)) {
            // When bit 13 is set, the linker detects errors at link time but
            // still creates an executable file.
            console.log("Linker detects errors at link time but still creates an executable file.");
        }

        if (flags & (1 << 15)) {
            // When bit 15 is set, the executable file is a library module.
            console.log("Library module!");
        }

        let autoDataSegmentIndex = this.header.autoDataSegmentIndex;

        this._CS = this.header.entryPointCS;
        this._DS = autoDataSegmentIndex;
        this._IP = this.header.entryPointIP;
        this._SS = this.header.initialStackPointerSS;
        this._SP = this.header.initialStackPointerSP;

        console.log("ENTRY", this.cs.toString(16), ':',  this.ip.toString(16));

        await this.readResidentEntries();
        await this.readNonResidentEntries();
        await this.readModuleReferenceEntries();
        await this.readSegments();
    }

    /**
     * This function loads the segment information from the executable.
     */
    async readSegments() {
        let count = this.header.segmentCount;
        let offset = this.header.segmentTableOffset;

        // Clear segments
        this._segments = [];

        offset += this.executable.headerOffset;

        for (var i = 0; i < count; i++) {
            console.log("Loading segment");
            let segment = {};

            // This is a logical unit that lists the pages from start of file.
            let segmentOffset = await this._stream.read16(offset, true);
            // If pageSize is 0, shift 9 (512 bytes)
            segmentOffset <<= (this.header.pageSize || 9);
            // A length of 0 means 64K (2^16)
            let segmentLength = await this._stream.read16(offset + 2, true) || 65536;
            let segmentFlags = await this._stream.read16(offset + 4, true);
            let segmentMinAllocation = await this._stream.read16(offset + 6, true);

            if (segmentFlags & 0x1) {
                // Bit 0 Set: Data segment, Clear: Code segment
                console.log("Data segment!");
                segment.data = true;
            }
            else {
                console.log("Code segment!");
                segment.code = true;
            }

            console.log("segment offset:", segmentOffset, "length:", segmentLength, "minAlloc:", segmentMinAllocation);
            segment.offset = segmentOffset;
            segment.length = segmentLength;
            segment.minAllocation = segmentMinAllocation;

            if (segmentFlags & 0x2) {
                // Bit 1 Set: Loader has allocated memory for the segment.
                console.log("Loader has allocated memory.");
            }

            if (segmentFlags & 0x4) {
                // Bit 2 Set: The segment is loaded.
                console.log("This segment is loaded.");
                segment.loaded = true;
            }

            if (segmentFlags & 0x10) {
                // Bit 4 Set: Segment type is MOVABLE, Clear: type is FIXED
                console.log("MOVABLE!");
                segment.movable = true;
            }
            else {
                console.log("FIXED!");
                segment.movable = false;
            }

            if (segmentFlags & 0x20) {
                // Bit 5 Set: Segment type is PURE/SHARABLE,
                //     Clear: Segment type is IMPURE/NONSHARABLE
                console.log("PURE/SHARABLE!");
                segment.sharable = true;
            }
            else {
                console.log("IMPURE/NONSHARABLE!");
                segment.sharable = false;
            }

            if (segmentFlags & 0x40) {
                // Bit 6 Set: Segment type is PRELOAD
                //     Clear: Segment type is LOADONCALL
                console.log("PRELOAD!");
                segment.preload = true;
            }
            else {
                console.log("LOADONCALL!");
                segment.preload = false;
            }

            segment.writable = true;
            if (segmentFlags & 0x80) {
                // Bit 7 Set: If code segment, type is EXECUTEONLY
                //            If data segment, type is READONLY
                console.log("EXECUTEONLY/READONLY!");
                segment.writable = false;
            }

            segment.relocations = [];

            if (segmentFlags & 0x100) {
                // Bit 8 Set: Segment contains relocation data.
                console.log("RELOCATION DATA!");

                // Read the relocation data?
                let relocationOffset = segmentOffset + segmentLength;
                let relocationCount = await this._stream.read16(relocationOffset, true);

                let importedNamesOffset = this.header.importedNamesOffset +
                                          this.executable.headerOffset;

                relocationOffset += 2;

                for (var ri = 0; ri < relocationCount; ri++) {
                    let addressType = await this._stream.read8(relocationOffset);
                    let type = await this._stream.read8(relocationOffset + 1);

                    // Get ADDITIVE flag
                    let additive = false;
                    if (type == 0x4) {
                        additive = true;
                        type &= ~0x4;
                    }

                    let itemOffset = await this._stream.read16(relocationOffset + 2, true);

                    if (type == 0) {
                        // Internal reference

                        // Other loaders seem to assume 5th byte not being 0xff
                        // means it is the segment index. The documentation says
                        // otherwise.
                        //
                        // The docs suggest that this is determined by whether
                        // or not the segment is marked 'movable', but the
                        // values are mutually exclusive.
                        //
                        // Thus, it might not hurt to be that conservative.
                        let segmentNumber = await this._stream.read8(relocationOffset + 4);
                        let sixth = await this._stream.read8(relocationOffset + 5);

                        // Sixth byte should be zero.
                        if (sixth != 0x00) {
                            console.log("Invalid segment relocation data.");
                        }

                        if (segmentNumber != 0xff) {
                            // If the relocation type is an internal reference and
                            // the segment is fixed (not movable), the fifth byte
                            // specifies the segment number, sixth byte is zero, and
                            // the seventh and eighth bytes specify an offset to the
                            // segment.
                            let fixedSegmentOffset = await this._stream.read16(relocationOffset + 6, true);

                            segment.relocations.push({
                                type: Loader.RELOCATION_FIXED,
                                addressType: addressType,
                                offset: itemOffset,
                                segment: segmentNumber,
                                targetOffset: fixedSegmentOffset,
                                additive: additive
                            });
                        }
                        else {
                            // If the segment is movable instead, the fifth byte
                            // specifies 0FFh (255), the sixth byte is zero, and the
                            // seventh and eighth bytes specify an ordinal value
                            // found in the segment's entry table.
                            let entryTableIndex = await this._stream.read16(relocationOffset + 6, true);

                            segment.relocations.push({
                                type: Loader.RELOCATION_ORDINAL,
                                addressType: addressType,
                                offset: itemOffset,
                                ordinal: entryTableIndex,
                                additive: additive
                            });
                        }
                    }
                    else if (type == 1) {
                        // Imported by ordinal (index)
                        // This starts at '1'
                        let importIndex = await this._stream.read16(relocationOffset + 4, true) - 1;
                        let procedureOrdinal = await this._stream.read16(relocationOffset + 6, true);

                        //console.log("Imported from", this.moduleReferenceEntries[importIndex], "at", procedureOrdinal);
                        segment.relocations.push({
                            type: Loader.RELOCATION_IMPORT,
                            addressType: addressType,
                            offset: itemOffset,
                            from: this.moduleReferenceEntries[importIndex].name,
                            ordinal: procedureOrdinal,
                            additive: additive
                        });
                    }
                    else if (type == 2) {
                        // Imported by name
                        // This starts at '1'
                        let importIndex = await this._stream.read16(relocationOffset + 4, true) - 1;
                        let importNameOffset = await this._stream.read16(relocationOffset + 6, true);
                        segment.relocations.push({
                            type: Loader.RELOCATION_IMPORT,
                            addressType: addressType,
                            offset: itemOffset,
                            from: this.moduleReferenceEntries[importIndex].name,
                            name: importNameOffset,
                            additive: additive
                        });
                    }
                    else {
                        console.log("WHAT IS THIS");
                    }

                    relocationOffset += 8;
                }
            }

            offset += 8;

            this._segments.push(segment);
        }
    }

    get residentEntries() {
        return this._residentEntries.slice();
    }

    get nonResidentEntries() {
        return this._nonResidentEntries.slice();
    }

    get moduleReferenceEntries() {
        return this._moduleReferenceEntries.slice();
    }

    get exports() {
        return this._exports.slice();
    }

    async _readStringList(offset, count = -1) {
        let nameLength = 0;

        // Set the maximum number of strings we feel like reading.
        if (count < 0) {
            count = 100;
        }

        let ret = [];
        while (count > 0 && (nameLength = await this._stream.read8(offset))) {
            let name = await Util.readAsyncString(this._stream, offset + 1, nameLength);

            offset += (nameLength + 1);
            ret.push({
                name: name
            });
            count--;
        }

        return ret;
    }

    async _readStringTable(offset, size = -1) {
        // This offset, unlike others, is from the beginning of the dang file.

        let nameLength = 0;

        let last = this._stream.byteLength;
        if (size >= 0) {
            last = offset + size;
        }

        let ret = []
        while (offset < last && (nameLength = await this._stream.read8(offset))) {
            let name = await Util.readAsyncString(this._stream, offset + 1, nameLength);
            let index = await this._stream.read16(offset + nameLength + 1, true);

            offset += (nameLength + 3);
            ret.push({
                name: name,
                index: index
            });
        }

        return ret;
    }

    async readResidentEntries() {
        let offset = this.header.residentNamesOffset;
        offset += this.executable.headerOffset;

        this._residentEntries = await this._readStringTable(offset);
    }

    async readNonResidentEntries() {
        // This offset, unlike others, is from the beginning of the dang file.
        let offset = this.header.nonresidentNamesOffset;
        let size = this.header.nonresidentNamesSize;

        this._nonResidentEntries = await this._readStringTable(offset, size);

        this._exports = new Array(this._nonResidentEntries.length);
        this._nonResidentEntries.forEach( (entry, i) => {
            this._exports[entry.index] = entry;
        });
    }

    async readModuleReferenceEntries() {
        let offset = this.header.moduleReferenceOffset;
        offset += this.executable.headerOffset;

        let importedNamesOffset = this.header.importedNamesOffset +
                                  this.executable.headerOffset;

        let count = this.header.moduleReferenceCount;

        this._moduleReferenceEntries = [];
        for (let mi = 0; mi < count; mi++) {
            let nameOffset = await this._stream.read16(offset, true);
            offset += 2;

            nameOffset += importedNamesOffset;
            let nameLength = await this._stream.read8(nameOffset);
            let name = await Util.readAsyncString(this._stream, nameOffset + 1, nameLength);
            this._moduleReferenceEntries.push({
                name: name
            });
        }
    }

    /**
     * Returns information about where the requested data exists in memory.
     *
     * The segment and offset are returned for the given ordinal.
     */
    lookup(ordinal) {
        // Get the original segment/offset for the ordiinal
        let entryPoints = this.executable.entryPoints;
        let entryPoint = entryPoints[ordinal];

        if (entryPoint) {
            // Map them
            return {
                segment: this._segmentMap[entryPoint.segment],
                offset: entryPoint.offset
            };
        }

        return null;
    }

    /**
     * Returns the real location of the given segmented address.
     */
    translate(segment) {
        return this._segmentMap[segment];
    }
}

// Internal reference
Loader.RELOCATION_FIXED = 0;

// Internal reference by ordinal
Loader.RELOCATION_ORDINAL = 1;

// Imported reference
Loader.RELOCATION_IMPORT = 2;

// A segment selector
Loader.RELOCATION_ADDRESSTYPE_SEGMENT = 0x2;

// A 32-bit pointer: Segment:Offset
Loader.RELOCATION_ADDRESSTYPE_FARADDR = 0x3;

// A 16-bit pointer offset
Loader.RELOCATION_ADDRESSTYPE_OFFSET = 0x5;

export default Loader;
