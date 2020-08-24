"use strict";

import { Loader } from './loader.js';

/**
 * This links executables after being loaded into memory.
 */
export class Linker {
    constructor(memory, modules, options = {}) {
        this._memory = memory;
        this._modules = modules;
    }

    get memory() {
        return this._memory;
    }

    get modules() {
        return this._modules;
    }

    /**
     * Links the executable.
     */
    link(task) {
        // Go through the relocations and link/load imported modules

        // Link each segment relocations
        task.loader.segments.forEach( (segment, i) => {
            // TODO: get the actual segment index
            let segmentIndex = i + 1;
            let relocations = segment.relocations;

            relocations.sort( (a, b) => a.offset - b.offset );

            relocations.forEach( (relocation) => {
                if (relocation.type == Loader.RELOCATION_IMPORT) {
                    let module = this.modules.fromName(relocation.from);

                    if (module) {
                        module = this.modules.load(module);
                        if (relocation.ordinal) {
                            let segment = module.segment;
                            let offset = module.step * (relocation.ordinal + 1);

                            if (relocation.addressType == Loader.RELOCATION_ADDRESSTYPE_SEGMENT) {
                                this.writeRelocation16(
                                    relocation, segmentIndex,
                                    (segment << 3) | 0x3
                                );
                            }
                            else if (relocation.addressType == Loader.RELOCATION_ADDRESSTYPE_FARADDR) {
                                this.writeRelocation32(
                                    relocation, segmentIndex,
                                    (segment << 3) | 0x3, offset
                                );
                            }
                            else if (relocation.addressType == Loader.RELOCATION_ADDRESSTYPE_OFFSET) {
                                this.writeRelocation16(
                                    relocation, segmentIndex,
                                    offset
                                );
                            }
                        }
                        else {
                            console("HMM");
                        }
                    }
                    else {
                        console.log("WE NEED", relocation.from + ".DLL");
                    }
                }
                else {
                    // Internal relocation

                    // Get the segment:offset that should be written (if fixed)
                    let segment = relocation.segment;
                    let offset = relocation.targetOffset;

                    // Get the entrypoint for that ordinal (if movable)
                    if (relocation.ordinal) {
                        let entryPoint = task.executable.entryPoints[relocation.ordinal];
                        segment = entryPoint.segment;
                        offset = entryPoint.offset;
                    }

                    // TODO: lookup appropriate segment number

                    if (relocation.addressType == Loader.RELOCATION_ADDRESSTYPE_SEGMENT) {
                        this.writeRelocation16(
                            relocation, segmentIndex,
                            (segment << 3) | 0x3
                        );
                    }
                    else if (relocation.addressType == Loader.RELOCATION_ADDRESSTYPE_FARADDR) {
                        this.writeRelocation32(
                            relocation, segmentIndex,
                            (segment << 3) | 0x3, offset
                        );
                    }
                    else if (relocation.addressType == Loader.RELOCATION_ADDRESSTYPE_OFFSET) {
                        this.writeRelocation16(
                            relocation, segmentIndex,
                            offset
                        );
                    }
                }
            });
        });
    }

    /**
     * Writes the relocation data to the indicated memory for a 16-bit value.
     *
     * The value can be an offset or a segment number.
     *
     * @param {Object} relocation - The relocation metadata.
     * @param {number} destinationSegment - The segment to write.
     * @param {number} value - The value to write.
     */
    writeRelocation16(relocation, destinationSegment, value) {
        if (relocation.additive) {
            // Not a relocation chain... just add to the current value
            offset += this._memory.read16(destinationSegment, relocation.offset);
            this._memory.write16(destinationSegment, relocationOffset, value);
        }
        else {
            let nextOffset = relocation.offset;
            let limit = 1000;
            while (limit > 0 && nextOffset != 0xffff) {
                // Get the next offset
                let thisOffset = nextOffset;
                nextOffset = this._memory.read16(destinationSegment, thisOffset)

                // Rewrite the code segment
                this._memory.write16(destinationSegment, thisOffset, value);

                limit--;
            }
        }
    }

    /**
     * Writes the relocation data to the indicated memory for a 32-bit pointer.
     *
     * The 32-bit pointer is provided in each 16-bit part: The segment and
     * offset values.
     *
     * @param {Object} relocation - The relocation metadata.
     * @param {number} destinationSegment - The segment to write.
     * @param {number} segment - The segment to write.
     * @param {number} offset - The offset to write.
     */
    writeRelocation32(relocation, destinationSegment, segment, offset) {
        if (relocation.additive) {
            // Not a relocation chain... just add to the current values
            offset += this._memory.read16(destinationSegment, relocation.offset);
            segment += this._memory.read16(destinationSegment, relocation.offset + 2);
            this._memory.write16(destinationSegment, relocation.offset, offset);
            this._memory.write16(destinationSegment, relocation.offset + 2, segment);
        }
        else {
            let nextOffset = relocation.offset;
            let limit = 1000;
            while (limit > 0 && nextOffset != 0xffff) {
                // Get the next offset
                let thisOffset = nextOffset;
                nextOffset = this._memory.read16(destinationSegment, thisOffset)

                // Rewrite the code segment
                this._memory.write16(destinationSegment, thisOffset, offset);
                this._memory.write16(destinationSegment, thisOffset + 2, segment);

                limit--;
            }
        }
    }
}
