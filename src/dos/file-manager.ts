import { stampAt } from '../file-systems/fat16.js';
import { Stream } from '../stream.js';

/**
 * Represents the high-level file-system and maintains open file handles.
 */
export class FileManager {
  declare _descriptors: any;
  declare _drive: any;
  declare _handles: any;
  declare _map: any;
  declare _pwd: any;
  declare _systemLibsPath: any;
  declare _systemRootPath: any;
  declare static MAX_OPEN_FILES: any;
  /** DOS's clock: what a file written or made is stamped with. Null leaves
   * each file system its own. */
  now: (() => Date) | null = null;
  /** How many times DOS has been asked anything: KERNEL's profiles look
   * again at a file's stamp once there has been a DOS call since they last
   * did (`KRNL386.EXE` seg1 `1b68`). */
  activity = 0;
  constructor() {
    // This keeps track of the drive mapping
    this._map = {};

    // Keep track of open files
    this._descriptors = [];

    // The default lookup paths
    this._systemRootPath = 'C:\\WINDOWS\\';
    this._systemLibsPath = 'C:\\WINDOWS\\SYSTEM\\';

    // For every drive, set its current directory
    this._pwd = {};
    this._pwd['C'] = 'C:\\';

    // Set the current drive
    this._drive = 'C';
  }

  /** A DOS call noted: anything asked of DOS, files or not. */
  touch() {
    this.activity++;
  }

  /**
   * A folder's entries changed -- one made in it, deleted from it or
   * renamed -- and its stamp DOS's clock's now: DOSBox's C: is a folder of
   * the host's, whose stamp moves so and not when a file in it is written
   * (**recorded** by `dirorder`). The root's is its file system's own. As
   * `files.rs`'s `changed`.
   *
   * @param {string} drive - The folder's drive.
   * @param {string[]} parts - Its names from the root.
   */
  async changed(drive: string, parts: string[]) {
    const fileSystem = this.query(drive);

    if (!this.now || !fileSystem) {
      return;
    }

    if (!parts.length) {
      fileSystem.rootStamp = stampAt(this.now());
      return;
    }

    const folder = await fileSystem.open(parts);

    if (folder?.info?.directory && folder.stamp) {
      await folder.stamp(this.now());
    }
  }

  /**
   * Retrieves the current drive letter.
   */
  get drive() {
    return this._drive;
  }

  /**
   * Sets, if possible, the current drive letter to the given drive.
   */
  set drive(letter) {
    this._drive = letter;
  }

  get path() {
    return this._pwd[this.drive];
  }

  set path(value) {
    // TODO: what happens when the value contains a drive letter
    // and it does not match the current drive?
    if (!value.endsWith('\\')) {
      value = value + '\\';
    }
    this._pwd[this.drive] = value;
  }

  get handleManager() {
    return this._handles;
  }

  get systemRootPath() {
    return this._systemRootPath;
  }

  get systemLibsPath() {
    return this._systemLibsPath;
  }

  async load(files) {
    await Promise.all(
      Object.keys(files).map(async (path) => {
        const url = files[path];

        // We need the size of the file
        const stream = new Stream(url);
        await stream.head();

        // We can now allocate the file blocks for it on disk
        await this.map(path, stream);
      })
    );
  }

  mount(name, fileSystem) {
    this._map[name] = fileSystem;
  }

  unmount(name) {
    delete this._map[name];
  }

  query(drive) {
    return this._map[drive];
  }

  /**
   * Parses the path into its relevant parts.
   */
  parse(path) {
    // Get the drive
    let drive = '';
    if (path.indexOf(':') >= 0) {
      const parts = path.split(':');
      /* In either case, as DOS reads a drive's letter and the Rust
       * engine's `Files::parse` takes it: Caribbean Treasure's installer
       * makes `c:\windows\games\carrib.exe`. */
      drive = parts[0].toUpperCase();
      path = parts[1];
    }

    // Convert slashes, every one
    path = path.replaceAll('/', '\\');

    // Remove leading slash
    if (path[0] === '\\') {
      path = path.substring(1);
    }

    /* Split by slash, `.` the folder it is in and `..` the one above, as DOS
     * reads them: Four Seasons opens `.\FS_CARDS.PIC` from its own folder.
     * Each name upper case, as DOS makes a path (DOSBox's `DOS_MakeName`)
     * and the Rust engine's drive keeps it: a file made as
     * `c:\windows\games\carrib.exe` is `CARRIB.EXE`. */
    const parts: string[] = [];

    for (const part of path.split('\\')) {
      if (part === '.') {
        continue;
      }

      if (part === '..') {
        parts.pop();
        continue;
      }

      parts.push(part.toUpperCase());
    }

    /* The folder itself, as the root is: one empty name. */
    if (!parts.length) {
      parts.push('');
    }

    return {
      drive: drive,
      path: parts,
    };
  }

  async map(path, data) {
    const pathInfo = this.parse(path);
    const fileSystem = this.query(pathInfo.drive);
    if (fileSystem) {
      await fileSystem.map(pathInfo.path, data);
    }
  }

  /**
   * Creates a file, replacing anything already there, and opens it.
   *
   * Unlike `open`, this does not search: a program creating a file means the
   * path it gave and nowhere else.
   *
   * @param {string} path - The path to create.
   * @returns {Promise<number>} An open file descriptor, or null.
   */
  async create(path) {
    this.touch();

    const pathInfo = this.parse(path);
    const fileSystem = this.query(pathInfo.drive);

    if (!fileSystem) {
      return null;
    }

    /* A file made where none was changes its folder; one emptied does not:
     * DOSBox's `localDrive::FileCreate` adds an entry only for a file that
     * was not there (`drive_local.cpp` 51-80). */
    const made = !(await fileSystem.open(pathInfo.path));

    /* Its archive bit set, as DOSBox lists every file of the host's folder
     * (`localDrive::FindNext` gives each `DOS_ATTR_ARCHIVE`) and the Rust
     * engine's drive lists a file: what an installer makes lists as 20h
     * (**recorded** by `instlay`). */
    await fileSystem.create(pathInfo.path, { archive: true });

    if (made) {
      await this.changed(pathInfo.drive, pathInfo.path.slice(0, -1));
    }

    const file = await fileSystem.open(pathInfo.path);

    if (!file) {
      return null;
    }

    file.mount = pathInfo.drive;

    /* Made now, as DOS stamps a file it makes. */
    if (this.now && file.stamp) {
      await file.stamp(this.now());
    }

    return this.allocate(file);
  }

  async open(path) {
    this.touch();

    // Collect paths to check, if not an absolute path (or forced).
    // These are listed in the order they are checked.
    let check = [
      this.path,
      this.systemRootPath,
      this.systemLibsPath,
      // TODO: Executable local directory of task
      // TODO: PATH variable
      // TODO: Network paths
    ];

    if (path.indexOf(':') >= 0) {
      check = [''];
    }

    let file = null;

    for (let i = 0; i < check.length; i++) {
      const dirPath = check[i];
      const filePath = dirPath + path;

      const pathInfo = this.parse(filePath);

      const fileSystem = this.query(pathInfo.drive);
      if (fileSystem) {
        // Get the inode
        file = await fileSystem.open(pathInfo.path);
        if (file) {
          file.mount = pathInfo.drive;
          break;
        }
      }
    }

    if (!file) {
      return null;
    }

    return this.allocate(file);
  }

  async list(path) {
    this.touch();

    const pathInfo = this.parse(path);

    const fileSystem = this.query(pathInfo.drive);
    if (fileSystem) {
      return await fileSystem.list(pathInfo.path);
    }

    return [];
  }

  /** An open file by its handle, told DOS's clock, which its writes are
   * stamped with. */
  resolve(handle) {
    this.touch();

    const file = this._descriptors[handle] || null;

    if (file) {
      file.now = this.now;
    }

    return file;
  }

  allocate(file) {
    /* Handles 0 to 4 are DOS's own devices, a file's the first free after
     * them: `_lcreat` answers 6 with one file open (`devinfo`). */
    let index = 5;

    while (this._descriptors[index] && index < FileManager.MAX_OPEN_FILES) {
      index++;
    }

    if (index < FileManager.MAX_OPEN_FILES) {
      this._descriptors[index] = file;
    } else {
      index = -1;
    }

    return index;
  }

  close(handle) {
    this.touch();

    // Deallocate the handle
    if (this._descriptors[handle]) {
      delete this._descriptors[handle];
      handle = -1;
    }

    return handle;
  }

  seek(handle, offset) {
    const file = this._descriptors[handle];

    if (file) {
      file.position += offset;

      if (file.position > file.size) {
        file.position = file.size;
      }
    }
  }

  seekTo(handle, offset, fromStart = true) {
    const file = this._descriptors[handle];

    if (file) {
      if (fromStart) {
        file.position = offset;
      } else {
        file.position = file.size - offset;
      }
    }
  }

  sizeOf(handle) {
    const file = this._descriptors[handle];

    let ret = -1;
    if (file) {
      ret = file.size;
    }

    return ret;
  }

  async read(handle, max) {
    const file = this._handles.resolve(handle);
    return await file.read(file.position, max);
  }

  async write(handle, data) {
    const file = this._handles.resolve(handle);
    return await file.write(file.position, data);
  }
}

FileManager.MAX_OPEN_FILES = 512;
