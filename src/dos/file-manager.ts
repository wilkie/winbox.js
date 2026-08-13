import { Stream } from "../stream.js";

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
    constructor() {
        // This keeps track of the drive mapping
        this._map = {};

        // Keep track of open files
        this._descriptors = [];

        // The default lookup paths
        this._systemRootPath = "C:\\WINDOWS\\";
        this._systemLibsPath = "C:\\WINDOWS\\SYSTEM\\";

        // For every drive, set its current directory
        this._pwd = {};
        this._pwd["C"] = "C:\\";

        // Set the current drive
        this._drive = "C";
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
        if (!value.endsWith("\\")) {
            value = value + "\\";
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
        await Promise.all(Object.keys(files).map( async (path) => {
            const url = files[path];

            // We need the size of the file
            const stream = new Stream(url);
            await stream.head();
            const size = stream.size;

            // We can now allocate the file blocks for it on disk
            await this.map(path, stream);
        }));
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
        let drive = "";
        if (path.indexOf(":") >= 0) {
            const parts = path.split(":");
            drive = parts[0];
            path = parts[1];
        }

        // Convert slashes
        path = path.replace("/", "\\");

        // Remove leading slash
        if (path[0] === "\\") {
            path = path.substring(1);
        }

        // Split by slash
        const parts = path.split("\\");

        return {
            "drive": drive,
            "path": parts
        };
    }

    async map(path, data) {
        const pathInfo = this.parse(path);
        const fileSystem = this.query(pathInfo.drive);
        if (fileSystem) {
            await fileSystem.map(pathInfo.path, data);
        }
    }

    async create(path) {
    }

    async open(path) {
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

        if (path.indexOf(":") >= 0) {
            check = [""];
        }

        let file = null;

        for (let i = 0; i < check.length; i++) {
            const dirPath = check[i];
            const filePath = dirPath + path;
            console.log(dirPath);

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
        const pathInfo = this.parse(path);

        const fileSystem = this.query(pathInfo.drive);
        if (fileSystem) {
            return await fileSystem.list(pathInfo.path);
        }

        return [];
    }

    resolve(handle) {
        return this._descriptors[handle] || null;
    }

    allocate(file) {
        let index = 3;

        while (this._descriptors[index] && index < FileManager.MAX_OPEN_FILES) {
            index++;
        }

        if (index < FileManager.MAX_OPEN_FILES) {
            this._descriptors[index] = file;
        }
        else {
            index = -1;
        }

        return index;
    }
    
    close(handle) {
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
            }
            else {
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
