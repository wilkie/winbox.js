/**
 * This exposes the global (segment) allocator of the 16-bit system.
 *
 * We are making it rather easy on ourselves by assuming we have infinite
 * memory. So, segments more or less point to continuous 64K blocks.
 *
 * That is, the memory is 1:1 mapped.
 */
export class GlobalAllocator {
    constructor(cpu, memory) {
        this._memory = memory;
        this._cpu = cpu;
        this._usedMap = new Array(8192);

        // Segment 0 is a system segment always
        this._usedMap[0] = true;

        this.reset();
    }

    reset() {
        // Initialize the GDT
        this._cpu.core.gdtBase = 0xffff0000;
        this._cpu.core.gdtLimit = 0xffff;
        this._memory.zero(this._cpu.core.gdtBase, 8 * 8192);

    }

    /**
     * Retrieves the connected cpu object.
     */
    get cpu() {
        return this._cpu;
    }

    /**
     * Retrieves the connected memory object.
     */
    get memory() {
        return this._memory;
    }

    /**
     * Maps in the given segment with the given access options to the system.
     *
     * We can provide initial data for the segment.
     */
    map(segment, data, options = {}) {
        if (this._usedMap[segment]) {
            console.log("OH NO. OVERWRITING SEGMENT.");
        }

        this._usedMap[segment] = true;

        // Modify the GDT to point to the segment
        let base = this._cpu.core.gdtBase
        base = base + (8 * segment);

        // Limit of 0xffff (64K)
        this._memory.write16(base, 0xffff);

        // Base (1:1 mapping, so 64K * segment index)
        let segmentBase = segment << 16;
        this._memory.write16(base + 2, segmentBase & 0xffff);
        this._memory.write8(base + 4, (segmentBase >> 16) & 0xff);
        this._memory.write8(base + 7, (segmentBase >> 24) & 0xff);

        // Write flags
        let flags = 0x80 | 0x10; // Present | Code
        this._memory.write8(base + 5, flags);
        this._memory.write8(base + 6, 0);

        console.log("updating gdt at", segment.toString(16), base.toString(16));

        // Copy the memory into the segment
        this._memory.write(segment << 16, data)
    }

    /**
     * Finds an unallocated segment or set of sequential unallocated segments.
     */
    find(start = 1, count = 1) {
        for (let i = start; i < this._usedMap.length; i++) {
            let j = 0;
            for ( ; j < count; j++) {
                if (this._usedMap[i + j]) {
                    break;
                }
            }

            if (j == count) {
                return i;
            }
        }

        return -1;
    }
}
