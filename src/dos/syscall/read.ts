export async function read(handle, address, max) {
  const file = this.files.resolve(handle);
  console.log('DOS: read()', handle, file, address.toString(16), max);

  // TODO: encode access
  // TODO: handle errors
  // TODO: return the error code for the error and set carry flag
  if (!file) {
    throw 0x6; // INVALID_HANDLE
  }

  // Read the data
  const data = await file.read(file.position, max);
  file.position += data.byteLength;

  // Copy the data to memory
  this.machine.memory.write(address, new DataView(data));

  return data.byteLength;
}
