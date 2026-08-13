/**
 * Changes the current directory to the given path.
 *
 * @param {string} path - The new current path.
 */
export function chdir(path) {
  console.log('DOS: CHDIR(', path, ')');

  // Determine if the given path exists

  // If it does, change to it
  this.files.path = path;

  // Return any error
  return true;
}
