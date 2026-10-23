export async function read(handle, address, max) {
  const file = this.files.resolve(handle);

  // TODO: encode access
  // TODO: handle errors
  // TODO: return the error code for the error and set carry flag
  if (!file) {
    throw 0x6; // INVALID_HANDLE
  }

  /* A disk image's file opened to write alone (`fatFile::Read`,
   * `drive_fat.cpp` 108-111): access denied. As `dos.rs`. */
  if (file.refusesRead?.()) {
    throw 0x5;
  }

  // Read the data
  const data = await file.read(file.position, max);
  file.position += data.byteLength;

  // Copy the data to memory
  this.machine.memory.write(address, new DataView(data));

  return data.byteLength;
}
