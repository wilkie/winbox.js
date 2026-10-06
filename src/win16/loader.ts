'use strict';

import { Util } from '../util.js';

/**
 * A relocation record's flags: its kind in the low two bits -- an internal
 * reference, an import by ordinal or by name, an OS fixup -- and ADDITIVE
 * (4), the value added to what the site holds rather than written down its
 * chain, for any kind. Catz's CATZ.WAD imports its library's variables by
 * ordinal so, an offset fixup added to the field's offset in the variable
 * (`mov [es:0x2],dx` for a far pointer's selector): taken for some other
 * kind, the offset was never written, and every such variable was read at
 * the start of its segment.
 *
 * @param {number} flags - The record's second byte.
 *
 * @returns {{type: number, additive: boolean}} Its kind and whether it adds.
 */
export function relocationFlags(flags: number) {
  return { type: flags & 0x3, additive: (flags & 0x4) !== 0 };
}

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
  declare _CS: any;
  declare _DS: any;
  declare _IP: any;
  declare _SP: any;
  declare _SS: any;
  declare _executable: any;
  declare _exports: any;
  declare _globalAllocator: any;
  declare _header: any;
  declare _isApp: any;
  declare _isDLL: any;
  declare _moduleReferenceEntries: any;
  declare _nonResidentEntries: any;
  declare _residentEntries: any;
  declare _segmentMap: any;
  declare _segments: any;
  declare _stream: any;
  declare static RELOCATION_ADDRESSTYPE_FARADDR: any;
  declare static RELOCATION_ADDRESSTYPE_OFFSET: any;
  declare static RELOCATION_ADDRESSTYPE_SEGMENT: any;
  declare static RELOCATION_FIXED: any;
  declare static RELOCATION_IMPORT: any;
  declare static RELOCATION_OSFIXUP: any;
  declare static RELOCATION_ORDINAL: any;
  /**
   * Creates a loader that will place the given executable into the given
   * memory.
   */
  constructor(executable, globalAllocator, _options = {}) {
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
      const segment = this.segments[i];
      let view = new DataView(await this._stream.read(segment.offset, segment.length));

      if (segment.iterated) {
        view = Loader.expand(view);
      }

      // Allocate a segment
      const segmentIndex = this._globalAllocator.find();

      // Retain knowledge about where the executable segment was loaded
      this._segmentMap[i + 1] = segmentIndex;

      this._globalAllocator.map(segmentIndex, view, { code: !!segment.code });
    }
  }

  /**
   * Returns the proper name of this executable.
   */
  /** The file the module was loaded from, as the module manager keeps its handle by. */
  get path() {
    return this._executable?.path;
  }

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
    const flags = this.header.flags;
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
      console.log('First segment loads the application.');
    }

    if (flags & (1 << 13)) {
      // When bit 13 is set, the linker detects errors at link time but
      // still creates an executable file.
      console.log('Linker detects errors at link time but still creates an executable file.');
    }

    if (flags & (1 << 15)) {
      // When bit 15 is set, the executable file is a library module.
      console.log('Library module!');
    }

    const autoDataSegmentIndex = this.header.autoDataSegmentIndex;

    this._CS = this.header.entryPointCS;
    this._DS = autoDataSegmentIndex;
    this._IP = this.header.entryPointIP;
    this._SS = this.header.initialStackPointerSS;
    this._SP = this.header.initialStackPointerSP;

    console.log('ENTRY', this.cs.toString(16), ':', this.ip.toString(16));

    await this.readResidentEntries();
    await this.readNonResidentEntries();
    await this.readModuleReferenceEntries();
    await this.readSegments();
  }

  /**
   * This function loads the segment information from the executable.
   */
  /**
   * An iterated segment's records spelled out: each a word of repeats, a
   * word of length and that many bytes, until the image ends.
   */
  static expand(records: DataView): DataView {
    const parts: Uint8Array[] = [];
    let size = 0;

    for (let at = 0; at + 4 <= records.byteLength; ) {
      const repeats = records.getUint16(at, true);
      const length = records.getUint16(at + 2, true);
      const bytes = new Uint8Array(records.buffer, records.byteOffset + at + 4, length);

      for (let i = 0; i < repeats; i++) {
        parts.push(bytes);
        size += length;
      }

      at += 4 + length;
    }

    const image = new Uint8Array(size);
    let at = 0;

    for (const part of parts) {
      image.set(part, at);
      at += part.length;
    }

    return new DataView(image.buffer);
  }

  async readSegments() {
    const count = this.header.segmentCount;
    let offset = this.header.segmentTableOffset;

    // Clear segments
    this._segments = [];

    offset += this.executable.headerOffset;

    for (let i = 0; i < count; i++) {
      console.log('Loading segment');
      const segment: any = {};

      // This is a logical unit that lists the pages from start of file.
      let segmentOffset = await this._stream.read16(offset, true);
      // If pageSize is 0, shift 9 (512 bytes)
      segmentOffset <<= this.header.pageSize || 9;
      /* A length of 0 means 64K (2^16) of the file -- but a segment at offset
       * 0 has nothing in the file at all, only its minimum allocation to be
       * made: a Visual Basic program's data segment of two bytes. */
      const segmentLength = segmentOffset
        ? (await this._stream.read16(offset + 2, true)) || 65536
        : 0;
      const segmentFlags = await this._stream.read16(offset + 4, true);
      const segmentMinAllocation = await this._stream.read16(offset + 6, true);

      if (segmentFlags & 0x1) {
        // Bit 0 Set: Data segment, Clear: Code segment
        console.log('Data segment!');
        segment.data = true;
      } else {
        console.log('Code segment!');
        segment.code = true;
      }

      console.log(
        'segment offset:',
        segmentOffset,
        'length:',
        segmentLength,
        'minAlloc:',
        segmentMinAllocation
      );
      segment.offset = segmentOffset;
      segment.length = segmentLength;
      segment.minAllocation = segmentMinAllocation;

      if (segmentFlags & 0x2) {
        // Bit 1 Set: Loader has allocated memory for the segment.
        console.log('Loader has allocated memory.');
      }

      if (segmentFlags & 0x4) {
        // Bit 2 Set: The segment is loaded.
        console.log('This segment is loaded.');
        segment.loaded = true;
      }

      if (segmentFlags & 0x10) {
        // Bit 4 Set: Segment type is MOVABLE, Clear: type is FIXED
        console.log('MOVABLE!');
        segment.movable = true;
      } else {
        console.log('FIXED!');
        segment.movable = false;
      }

      if (segmentFlags & 0x20) {
        // Bit 5 Set: Segment type is PURE/SHARABLE,
        //     Clear: Segment type is IMPURE/NONSHARABLE
        console.log('PURE/SHARABLE!');
        segment.sharable = true;
      } else {
        console.log('IMPURE/NONSHARABLE!');
        segment.sharable = false;
      }

      if (segmentFlags & 0x40) {
        // Bit 6 Set: Segment type is PRELOAD
        //     Clear: Segment type is LOADONCALL
        console.log('PRELOAD!');
        segment.preload = true;
      } else {
        console.log('LOADONCALL!');
        segment.preload = false;
      }

      segment.writable = true;
      if (segmentFlags & 0x80) {
        // Bit 7 Set: If code segment, type is EXECUTEONLY
        //            If data segment, type is READONLY
        console.log('EXECUTEONLY/READONLY!');
        segment.writable = false;
      }

      /* Bit 3: the segment's image in the file is iterated records, each a
       * count of repeats, a length and the bytes repeated -- the data segment
       * of Championship Slots of the corpus. */
      segment.iterated = !!(segmentFlags & 0x8);

      segment.relocations = [];

      if (segmentFlags & 0x100) {
        // Bit 8 Set: Segment contains relocation data.
        console.log('RELOCATION DATA!');

        // Read the relocation data?
        let relocationOffset = segmentOffset + segmentLength;
        const relocationCount = await this._stream.read16(relocationOffset, true);

        relocationOffset += 2;

        for (let ri = 0; ri < relocationCount; ri++) {
          const addressType = await this._stream.read8(relocationOffset);
          const { type, additive } = relocationFlags(
            await this._stream.read8(relocationOffset + 1)
          );

          const itemOffset = await this._stream.read16(relocationOffset + 2, true);

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
            const segmentNumber = await this._stream.read8(relocationOffset + 4);
            const sixth = await this._stream.read8(relocationOffset + 5);

            // Sixth byte should be zero.
            if (sixth != 0x00) {
              console.log('Invalid segment relocation data.');
            }

            if (segmentNumber != 0xff) {
              // If the relocation type is an internal reference and
              // the segment is fixed (not movable), the fifth byte
              // specifies the segment number, sixth byte is zero, and
              // the seventh and eighth bytes specify an offset to the
              // segment.
              const fixedSegmentOffset = await this._stream.read16(relocationOffset + 6, true);

              segment.relocations.push({
                type: Loader.RELOCATION_FIXED,
                addressType: addressType,
                offset: itemOffset,
                segment: segmentNumber,
                targetOffset: fixedSegmentOffset,
                additive: additive,
              });
            } else {
              // If the segment is movable instead, the fifth byte
              // specifies 0FFh (255), the sixth byte is zero, and the
              // seventh and eighth bytes specify an ordinal value
              // found in the segment's entry table.
              const entryTableIndex = await this._stream.read16(relocationOffset + 6, true);

              segment.relocations.push({
                type: Loader.RELOCATION_ORDINAL,
                addressType: addressType,
                offset: itemOffset,
                ordinal: entryTableIndex,
                additive: additive,
              });
            }
          } else if (type == 1) {
            // Imported by ordinal (index)
            // This starts at '1'
            const importIndex = (await this._stream.read16(relocationOffset + 4, true)) - 1;
            const procedureOrdinal = await this._stream.read16(relocationOffset + 6, true);

            //console.log("Imported from", this.moduleReferenceEntries[importIndex], "at", procedureOrdinal);
            segment.relocations.push({
              type: Loader.RELOCATION_IMPORT,
              addressType: addressType,
              offset: itemOffset,
              from: this.moduleReferenceEntries[importIndex].name,
              ordinal: procedureOrdinal,
              additive: additive,
            });
          } else if (type == 2) {
            // Imported by name
            // This starts at '1'
            const importIndex = (await this._stream.read16(relocationOffset + 4, true)) - 1;
            const importNameOffset = await this._stream.read16(relocationOffset + 6, true);
            /* The procedure's name, in the imported-names table. */
            const namesAt = this.header.importedNamesOffset + this.executable.headerOffset + importNameOffset;
            const procedure = await Util.readAsyncString(this._stream, namesAt + 1, await this._stream.read8(namesAt));

            segment.relocations.push({
              type: Loader.RELOCATION_IMPORT,
              addressType: addressType,
              offset: itemOffset,
              from: this.moduleReferenceEntries[importIndex].name,
              name: importNameOffset,
              procedure: procedure,
              additive: additive,
            });
          } else if (type == 3) {
            /* An OS fixup: a floating-point instruction, made the emulator's
             * or left the coprocessor's as the linker applies it (see
             * `OS_FIXUPS` there). KERNEL passes over them in a module whose
             * flags have bit 3 set (`KRNL386.EXE` seg1 `7539`). */
            if (!(this.header.flags & 0x0008)) {
              segment.relocations.push({
                type: Loader.RELOCATION_OSFIXUP,
                addressType: addressType,
                offset: itemOffset,
                fixup: await this._stream.read16(relocationOffset + 4, true),
              });
            }
          } else {
            console.log('WHAT IS THIS');
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
    let nameLength;

    // Set the maximum number of strings we feel like reading.
    if (count < 0) {
      count = 100;
    }

    const ret = [];
    while (count > 0 && (nameLength = await this._stream.read8(offset))) {
      const name = await Util.readAsyncString(this._stream, offset + 1, nameLength);

      offset += nameLength + 1;
      ret.push({
        name: name,
      });
      count--;
    }

    return ret;
  }

  async _readStringTable(offset, size = -1) {
    // This offset, unlike others, is from the beginning of the dang file.

    let nameLength;

    /* The table ends at a length of nought; a stream read from a disk may not
     * know its own length, and then the file's end is no bound. */
    let last = this._stream.byteLength ?? this._stream.size ?? Infinity;
    if (size >= 0) {
      last = offset + size;
    }

    const ret = [];
    while (offset < last && (nameLength = await this._stream.read8(offset))) {
      const name = await Util.readAsyncString(this._stream, offset + 1, nameLength);
      const index = await this._stream.read16(offset + nameLength + 1, true);

      offset += nameLength + 3;
      ret.push({
        name: name,
        index: index,
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
    const offset = this.header.nonresidentNamesOffset;
    const size = this.header.nonresidentNamesSize;

    this._nonResidentEntries = await this._readStringTable(offset, size);

    this._exports = new Array(this._nonResidentEntries.length);
    this._nonResidentEntries.forEach((entry, _i) => {
      this._exports[entry.index] = entry;
    });
  }

  async readModuleReferenceEntries() {
    let offset = this.header.moduleReferenceOffset;
    offset += this.executable.headerOffset;

    const importedNamesOffset = this.header.importedNamesOffset + this.executable.headerOffset;

    const count = this.header.moduleReferenceCount;

    this._moduleReferenceEntries = [];
    for (let mi = 0; mi < count; mi++) {
      let nameOffset = await this._stream.read16(offset, true);
      offset += 2;

      nameOffset += importedNamesOffset;
      const nameLength = await this._stream.read8(nameOffset);
      const name = await Util.readAsyncString(this._stream, nameOffset + 1, nameLength);
      this._moduleReferenceEntries.push({
        name: name,
      });
    }
  }

  /**
   * The ordinal a module exports a name as: its resident names, then its
   * nonresident ones, compared without regard to case; the first of each
   * table is the module's name or its description, not an export. 0 for a
   * name it does not export.
   */
  ordinalOf(name: string) {
    const wanted = String(name).toUpperCase();
    const entry = [...this._residentEntries.slice(1), ...this._nonResidentEntries.slice(1)].find(
      (one) => String(one.name).toUpperCase() === wanted
    );

    return entry?.index ?? 0;
  }

  /**
   * Returns information about where the requested data exists in memory.
   *
   * The segment and offset are returned for the given ordinal.
   */
  lookup(ordinal) {
    // Get the original segment/offset for the ordiinal
    const entryPoints = this.executable.entryPoints;
    const entryPoint = entryPoints[ordinal];

    if (entryPoint) {
      // Map them
      return {
        segment: this._segmentMap[entryPoint.segment],
        offset: entryPoint.offset,
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
Loader.RELOCATION_OSFIXUP = 3;

// A segment selector
Loader.RELOCATION_ADDRESSTYPE_SEGMENT = 0x2;

// A 32-bit pointer: Segment:Offset
Loader.RELOCATION_ADDRESSTYPE_FARADDR = 0x3;

// A 16-bit pointer offset
Loader.RELOCATION_ADDRESSTYPE_OFFSET = 0x5;

export default Loader;
