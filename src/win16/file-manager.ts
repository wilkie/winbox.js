import { Stream } from '../stream.js';

/**
 * Represents the high-level file-system and maintains open file handles.
 */
export class FileManager {
  declare _fileSystem: any;
  declare _handles: any;
  declare _map: any;
  declare _systemLibsPath: any;
  declare _systemRootPath: any;
  constructor(handleManager) {
    // This keeps track of the drive mapping
    this._map = {};

    // Retains the handle manager
    this._handles = handleManager;

    // The default lookup paths
    this._systemRootPath = 'C:\\WINDOWS\\';
    this._systemLibsPath = 'C:\\WINDOWS\\SYSTEM\\';
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

        const size = stream.size;
        console.log(path, '=>', url, size);

        // We can now allocate the file blocks for it on disk
        await this.map(path, stream);
        console.log('done');
      })
    );
    console.log('DONE');
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
    // TODO: parse the drive in the file manager
    // and use that to decide when file system
    // is being accessed.
    console.log('parsing', path);

    // Get the drive
    let drive = '';
    if (path.indexOf(':') >= 0) {
      const parts = path.split(':');
      drive = parts[0];
      path = parts[1];
    }

    // Convert slashes
    path = path.replace('/', '\\');

    // Remove leading slash
    if (path[0] === '\\') {
      path = path.substring(1);
    }

    // Split by slash
    const parts = path.split('\\');

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

  async create(path) {}

  async open(path) {
    // Collect paths to check, if not an absolute path (or forced).
    // These are listed in the order they are checked.
    let check = [
      // TODO: Current directory
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

    return this._handles.allocate(file);
  }

  async list(path) {
    const pathInfo = this.parse(path);

    const fileSystem = this.query(pathInfo.drive);
    if (fileSystem) {
      return await fileSystem.list(pathInfo.path);
    }

    return [];
  }

  close(handle) {
    // Deallocate the handle
    this._handles.free(handle);
  }

  seek(handle, offset) {
    const file = this._handles.resolve(handle);
    file.position += offset;

    if (file.position > file.size) {
      file.position = file.size;
    }
  }

  seekTo(handle, offset, fromStart = true) {
    const file = this._handles.resolve(handle);

    if (fromStart) {
      file.position = offset;
    } else {
      file.position = file.size - offset;
    }
  }

  sizeOf(handle) {
    const file = this._handles.resolve(handle);
    this._fileSystem.sizeOf(file.inode);
  }

  read(handle, address, max) {
    const file = this._handles.resolve(handle);
    const length = this._fileSystem.read(file.inode, file.position, address, max);
    file.position += length;
  }

  write(handle, address, length) {
    const file = this._handles.resolve(handle);
    this._fileSystem.write(file.inode, file.position, address, length);
    file.position += length;
  }
}
