export async function open(path, access) {
    console.log("DOS: open()", path, access);
    const handle = await this.files.open(path);
    const file = this.files.resolve(handle);

    console.log("DOS: open()", handle, file);

    // TODO: encode access
    // TODO: handle errors
    // TODO: return the error code for the error and set carry flag
    if (!file) {
        throw 0x2; // FILE_NOT_FOUND
    }

    return handle;
}
