export async function LoadLibrary(lpszLibFileName) {
  // See if the module is already loaded
  let handle = await this.dos.files.open(lpszLibFileName);
  const file = this.dos.files.resolve(handle);
  console.log('hmm', file);
  if (file) {
    // Form the full path
    const path = file.mount + ':' + file.path;
    console.log('found at', path);
    this.dos.files.close(file);

    // Get the module handle, if it exists
    handle = this.modules.handleFromPath(path);
    console.log('handle', handle);

    if (handle) {
      console.log('already loaded handle');
      return handle;
    }
  }

  return 0x0;
}
