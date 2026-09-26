/**
 * Makes a drive the current one (0Eh), 0 for A:, and answers how many drive
 * letters there are.
 *
 * A drive that is not there is not made current: the current drive stays as
 * it was, which is how a program finds the drives there are -- COMMDLG
 * selects each in turn and asks with 19h which is current. The count is every
 * letter, A: to Z:, as under DOSBox, where the oracle's Windows ran; MS-DOS
 * answers its `LASTDRIVE`.
 */
export function selectDisk(index) {
  const drive = String.fromCharCode(index + 'A'.charCodeAt(0));

  if (index < 26 && this.files.query(drive)) {
    this.drive = drive;
  }

  return 26;
}
