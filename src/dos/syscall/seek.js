export function seek(handle, hi, lo, basis) {
    let position = (hi << 16) | lo;
    let file = this.files.resolve(handle);
    console.log("DOS: seek()", handle, file, position.toString(16), ["start", "current", "end"][basis]);

    // TODO: encode access
    // TODO: handle errors
    // TODO: return the error code for the error and set carry flag
    if (!file) {
        throw 0x6; // INVALID_HANDLE
    }

    // Seek
    if (basis == 0) {
        // From beginning
        file.position = position;
    }
    else if (basis == 1) {
        file.position += position;
    }
    else if (basis == 2) {
        file.position = file.size - position;
    }

    let ret = file.position;

    // Get unsigned value
    ret = ret >>> 0;

    // Separate into hi/lo
    hi = (ret >> 16) & 0xffff;
    lo = ret & 0xffff;

    // Return the pair
    return [hi, lo];
}
