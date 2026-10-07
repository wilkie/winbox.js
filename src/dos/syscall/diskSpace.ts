/**
 * A drive's size and room (36h): DL the drive, 0 for the current one and 1
 * for A:; answers sectors to a cluster in AX, free clusters in BX, bytes to a
 * sector in CX and all the clusters in DX. A drive that is not there answers
 * FFFFh in AX and nothing else, with no carry, BX, CX and DX left as they
 * were. **Recorded** by `diskfree`: under DOSBox, B: answers FFFFh with the
 * 0B0Bh and 0C0Ch the probe put in BX and CX still there.
 *
 * The drive here is a FAT16 volume, which answers its own geometry. DOSBox's
 * C:, where the oracle's Windows ran, is a folder of the host's, which
 * answers a fixed one: 127 sectors to a cluster, 4031 free of 16383, 512
 * bytes to a sector (`MOUNT`'s "512,127,16383,4031"). The Rust engine's
 * drives, folders or trees in memory, answer that.
 */
export async function getDiskSpace(this: any, drive: number) {
  const letter = drive === 0 ? this.files.drive : String.fromCharCode(0x40 + drive);
  const fileSystem = drive > 26 ? null : this.files.query(letter);

  if (!fileSystem?.space) {
    return [0xffff];
  }

  const { sectorsPerCluster, bytesPerSector, clusters, free } = await fileSystem.space();

  return [sectorsPerCluster, free & 0xffff, bytesPerSector, clusters & 0xffff];
}
