export function close(handle) {
  const file = this.files.resolve(handle);

  // TODO: encode access
  // TODO: handle errors
  // TODO: return the error code for the error and set carry flag
  if (!file) {
    throw 0x6; // INVALID_HANDLE
  }

  // Close
  this.files.close(handle);
}
