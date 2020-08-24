import { Executable } from '../../executable.js';

export function LoadString(hinst, idResource, lpszBuffer, cbBuffer) {
    let memory = this.machine.memory;
    let executable = this.task.executable;

    // Strings are stored 16 at a time
    let stringId = idResource;
    idResource = (idResource / 16) >>> 0;
    idResource++;

    // Resource ids that are integers have the high-bit set in the executable
    idResource |= 0x8000;

    let destSegment = ((lpszBuffer >> 16) & 0xffff) >> 3;
    let destOffset = lpszBuffer & 0xffff;

    executable.resources.forEach( (resourceType) => {
        if (resourceType.id == Executable.RESOURCES.StringTable) {
            resourceType.entries.forEach( (resource) => {
                if (resource.id == idResource) {
                    let origOffset = destOffset;
                    let data = new Int8Array(executable.readResource(resource));

                    // Now go through the string data for the appropriate string.
                    let offset = 0;
                    for (let i = 0; i < stringId; i++) {
                        offset += 1 + data[offset];
                    }

                    // Then, we read the string data to memory.
                    let length = data[offset];
                    offset++;
                    for (let i = offset; i < offset + length; i++) {
                        memory.write8(destSegment, destOffset, data[i]);
                        destOffset++;
                    }

                    // Write the null-terminator as well.
                    memory.write8(destSegment, destOffset, 0);
                    console.log(memory.readCString(destSegment, origOffset));
                }
            });
        }
    });
    return 0;
}
