/**
 * A removable drive with nothing in it: a floppy drive whose disk was taken
 * out, or a CD-ROM drive whose disc was (`FileManager.eject`). DOS answers
 * it as DOSBox answers its floppy drive with nothing mounted: no drive
 * (`hasDisk`, error 0Fh), for it has no `space`. A CD-ROM drive stays
 * remote, so MSCDEX still counts it. As the Rust engine's `EmptyDrive`
 * (`crates/winbox-machine/src/files/empty.rs`).
 */
export class EmptyDrive {
  /** A CD-ROM drive's, as DOSBox's are remote. */
  readonly remote: boolean;

  constructor(remote = false) {
    this.remote = remote;
  }

  /** The drive another leaves when its disk is taken out. */
  static after(fileSystem: any) {
    return new EmptyDrive(Boolean(fileSystem?.remote));
  }

  get removable() {
    return true;
  }

  get label(): string | null {
    return null;
  }

  /** A CD-ROM drive's F8h, as its disc's; a floppy drive's F0h. */
  get mediaByte() {
    return this.remote ? 0xf8 : 0xf0;
  }

  get listing(): 'sorted' | 'stored' {
    return 'stored';
  }

  get changed() {
    return false;
  }

  /** Only its root, with nothing in it. */
  async open(parts: string[]) {
    if (parts.some((part) => part !== '')) {
      return null;
    }

    return {
      info: { directory: true, name: '', attributes: 0x10 },
      list: async () => [],
      lookup: async () => null,
    };
  }
}
