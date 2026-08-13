"use strict";

import { Loader } from './loader.js';

/**
 * This links executables after being loaded into memory.
 */
export class Linker {
    declare _memory: any;
    declare _modules: any;
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
     * Retrieves a list of external libraries it must have to link.
     */
    requirementsFor(task) {
        const ret = [];

        // Go through the relocations and see the required modules
        task.loader.segments.forEach( (segment, i) => {
            segment.relocations.forEach( (relocation) => {
                if (relocation.type == Loader.RELOCATION_IMPORT) {
                    const module = this.modules.fromName(relocation.from);

                    if (!module) {
                        // We do not have this module loaded already
                        if (ret.indexOf(relocation.from) < 0) {
                            ret.push(relocation.from);
                        }
                    }
                }
            });
        });

        return ret;
    }

    /**
     * Links the executable.
     */
    link(task) {
        // Go through the relocations and link/load imported modules

        // Link each segment relocations
        task.loader.segments.forEach( (segment, i) => {
            const segmentIndex = task.loader.translate(i + 1);
            const relocations = segment.relocations;

            relocations.sort( (a, b) => a.offset - b.offset );

            relocations.forEach( (relocation) => {
                if (relocation.type == Loader.RELOCATION_IMPORT) {
                    let module = this.modules.fromName(relocation.from);

                    if (module) {
                        module = this.modules.load(module);
                        if (relocation.ordinal) {
                            const info = module.lookup(relocation.ordinal);
                            const segment = info.segment;
                            const offset = info.offset;

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
                            console.log("HMM");
                        }
                    }
                    else {
                        console.log("WE NEED", relocation.from + ".DLL", "@", relocation.ordinal);
                    }
                }
                else {
                    // Internal relocation

                    // Get the segment:offset that should be written (if fixed)
                    let segment = relocation.segment;
                    let offset = relocation.targetOffset;

                    // Get the entrypoint for that ordinal (if movable)
                    if (relocation.ordinal) {
                        const entryPoint = task.executable.entryPoints[relocation.ordinal];
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
            value += this._memory.read16((destinationSegment << 16) + relocation.offset);
            this._memory.write16((destinationSegment << 16) + relocation.offset, value);
        }
        else {
            let nextOffset = relocation.offset;
            let limit = 1000;
            while (limit > 0 && nextOffset != 0xffff) {
                // Get the next offset
                const thisOffset = nextOffset;
                nextOffset = this._memory.read16((destinationSegment << 16) + thisOffset)

                // Rewrite the code segment
                this._memory.write16((destinationSegment << 16) + thisOffset, value);

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
            offset += this._memory.read16((destinationSegment << 16) + relocation.offset);
            segment += this._memory.read16((destinationSegment << 16) + relocation.offset + 2);
            this._memory.write16((destinationSegment << 16) + relocation.offset, offset);
            this._memory.write16((destinationSegment << 16) + relocation.offset + 2, segment);
        }
        else {
            let nextOffset = relocation.offset;
            let limit = 1000;
            while (limit > 0 && nextOffset != 0xffff) {
                // Get the next offset
                const thisOffset = nextOffset;
                nextOffset = this._memory.read16((destinationSegment << 16) + thisOffset)

                // Rewrite the code segment
                this._memory.write16((destinationSegment << 16) + thisOffset, offset);
                this._memory.write16((destinationSegment << 16) + thisOffset + 2, segment);

                limit--;
            }
        }
    }
}
