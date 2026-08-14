import { Stream } from './stream.js';

export class FileSystem {
  declare _disk: any;
  constructor(disk) {
    // The disk is the block device backed by actual storage
    this._disk = disk;

    // Install it to the given disk
    this._disk.fileSystem = this;
  }

  /**
   * Retrieves the current disk device attached to the file system.
   */
  get disk() {
    return this._disk;
  }

  async format() {
    throw 'Unimplemented';
  }

  async open(path, create = false) {
    throw 'Unimplemented';
  }

  async create(path, options = {}) {
    throw 'Unimplemented';
  }

  async map(path, data, options = {}) {
    throw 'Unimplemented';
  }

  async list(path) {
    throw 'Unimplemented';
  }

  async info(path) {
    throw 'Unimplemented';
  }

  async load(files, within = []) {
    const names = Object.keys(files);
    for (let i = 0; i < names.length; i++) {
      const path = names[i];
      const url = files[path];
      if (url instanceof Array) {
        const data = url;
        await this.map(within.concat([path]), data);
      } else if (!(url instanceof String || typeof url == 'string')) {
        await this.load(url, within.concat([path]));
      } else {
        // We need the size of the file
        const stream = new Stream(url);
        await stream.head();
        const size = stream.size;

        // We can now allocate the file blocks for it on disk
        await this.map(within.concat([path]), stream);
      }
    }
  }
}

export class File {
  declare _info: any;
  declare _mount: any;
  declare _position: any;
  constructor(info) {
    this._info = info;
    this._position = 0;
    this._mount = '';
  }

  get mount() {
    return this._mount;
  }

  set mount(value) {
    this._mount = value;
  }

  get info() {
    return this._info;
  }

  get name() {
    return this._info.name;
  }

  get size() {
    return this._info.size;
  }

  get position() {
    return this._position;
  }

  set position(value) {
    this._position = value;
  }

  async read(offset, length): Promise<any> {
    throw 'Unimplemented';
  }

  async read8(offset): Promise<any> {
    throw 'Unimplemented';
  }

  async read16(offset, littleEndian = true): Promise<any> {
    throw 'Unimplemented';
  }

  async read32(offset, littleEndian = true): Promise<any> {
    throw 'Unimplemented';
  }

  /**
   * Writes bytes at an offset, growing the file if it needs to.
   *
   * @param {number} offset - Where in the file to start.
   * @param {Uint8Array|DataView} data - What to write.
   * @returns {Promise<number>} How many bytes were written.
   */
  async write(offset, data): Promise<any> {
    throw 'Unimplemented';
  }

  async write8(offset, value): Promise<any> {
    throw 'Unimplemented';
  }

  async write16(offset, value, littleEndian = true): Promise<any> {
    throw 'Unimplemented';
  }

  async write32(offset, value, littleEndian = true): Promise<any> {
    throw 'Unimplemented';
  }

  async readCString(offset, max): Promise<any> {
    throw 'Unimplemented';
  }

  async writeString(offset, value, max): Promise<any> {
    throw 'Unimplemented';
  }

  async writeCString(offset, value, max): Promise<any> {
    throw 'Unimplemented';
  }
}
