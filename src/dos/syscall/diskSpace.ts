/**
 * A drive's size and room (36h): DL the drive, 0 for the current one and 1
 * for A:; answers sectors to a cluster in AX, free clusters in BX, bytes to a
 * sector in CX and all the clusters in DX. A drive that is not there answers
 * FFFFh in AX and nothing else, with no carry. DOS as it is documented.
 */
export async function getDiskSpace(this: any, drive: number) {
  const letter = drive === 0 ? this.files.drive : String.fromCharCode(0x40 + drive);
  const fileSystem = drive > 26 ? null : this.files.query(letter);

  if (!fileSystem?.space) {
    return [0xffff, 0, 0, 0];
  }

  const { sectorsPerCluster, bytesPerSector, clusters, free } = await fileSystem.space();

  return [sectorsPerCluster, free & 0xffff, bytesPerSector, clusters & 0xffff];
}
