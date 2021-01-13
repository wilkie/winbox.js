import { Stream } from "../stream.js";

/**
 * Represents the high-level file-system and maintains open file handles.
 */
export class FileManager {
    constructor(handleManager) {
        // This keeps track of the drive mapping
        this._map = {};

        // Retains the handle manager
        this._handles = handleManager;

        // The default lookup paths
        this._systemRootPath = "C:\\WINDOWS\\";
        this._systemLibsPath = "C:\\WINDOWS\\SYSTEM\\";
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
            let url = files[path];

            // We need the size of the file
            let stream = new Stream(url);
            await stream.head();

            let size = stream.size;
            console.log(path, "=>", url, size);

            // We can now allocate the file blocks for it on disk
            await this.map(path, stream);
            console.log("done");
        }));
        console.log("DONE");
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
        console.log("parsing", path);

        // Get the drive
        let drive = "";
        if (path.indexOf(":") >= 0) {
            let parts = path.split(":");
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
        let parts = path.split("\\");

        return {
            "drive": drive,
            "path": parts
        };
    }

    async map(path, data) {
        let pathInfo = this.parse(path);
        let fileSystem = this.query(pathInfo.drive);
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
            // TODO: Current directory
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
            let dirPath = check[i];
            let filePath = dirPath + path;

            let pathInfo = this.parse(filePath);

            let fileSystem = this.query(pathInfo.drive);
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
        let pathInfo = this.parse(path);

        let fileSystem = this.query(pathInfo.drive);
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
        let file = this._handles.resolve(handle);
        file.position += offset;

        if (file.position > file.size) {
            file.position = file.size;
        }
    }

    seekTo(handle, offset, fromStart = true) {
        let file = this._handles.resolve(handle);

        if (fromStart) {
            file.position = offset;
        }
        else {
            file.position = file.size - offset;
        }
    }

    sizeOf(handle) {
        let file = this._handles.resolve(handle);
        this._fileSystem.sizeOf(file.inode);
    }

    read(handle, address, max) {
        let file = this._handles.resolve(handle);
        let length = this._fileSystem.read(file.inode, file.position, address, max);
        file.position += length;
    }

    write(handle, address, length) {
        let file = this._handles.resolve(handle);
        this._fileSystem.write(file.inode, file.position, address, max);
        file.position += length;
    }
}
