import { FileSystem, File } from "../file-system.js";
import { Stream } from "../stream.js";

/**
 * Represents the low-level FAT16 file-system.
 */
export class FAT16 extends FileSystem {
    constructor(disk) {
        super(disk);

        // The stream mapping (where network storage can take the place of disk)
        this._streams = {};

        // Allocate a boot sector (cluster #0)
        this._boot = 0;
    }

    /**
     * Retrieves the size of a cluster in bytes.
     */
    get clusterSize() {
        return this._clusterSize;
    }

    get sectorsPerCluster() {
        return this._sectorsPerCluster;
    }

    get firstSector() {
        return this._firstSector;
    }

    async format() {
        // Allocate the boot sector
        await this.writeBootSector();

        // Allocate the file allocation table
        await this.writeFAT();

        // The inode for the root directory
        this._root = this._fatIndex + (this._fatSectors * 2);

        // Zero out root by simply writing a 0 to its first byte
        await this.disk.write8(this._root, 0, 0);
    }

    /**
     * Returns the index of a block and marks it used.
     */
    async allocate(from = 0) {
        let ret = await this.find();

        // Write EOF to allocate it
        await this.writeFATEntry(ret, 0xffff);

        // Write the linked entry, if given
        if (from > 0) {
            await this.writeFATEntry(from, ret);
        }

        return ret;
    }

    /**
     * Frees a used block.
     */
    async free(index) {
        this._blocks[index] = false;
    }

    /**
     * Finds a free block and returns its index.
     */
    async find(start = 2) {
        let i = start;
        for ( ; i < this._numClusters; i++) {
            if (await this.readFATEntry(i) == 0) {
                break;
            }
        }

        return i;
    }

    /**
     * Writes the FAT16 boot sector to the disk.
     */
    async writeBootSector() {
        // Write name/version of system
        await this.disk.writeString(this._boot, 3, "MSWIN4.1", 8);

        // Write the sector size (512 bytes)
        await this.disk.write16(this._boot, 11, 512);

        // Write the cluster size (64 sectors per cluster, 32,768 bytes)
        // We'll make the cluster size the same as the blockSize on disk,
        // essentially.
        this._clusterSize = this.disk.blockSize;
        this._sectorsPerCluster = Math.ceil(this.clusterSize / this.disk.sectorSize);
        await this.disk.write8(this._boot, 13, this._clusterSize / this.disk.sectorSize);

        // Number of reserved sectors
        await this.disk.write8(this._boot, 14, 1);

        // Number of root directory entries
        this._rootEntries = FAT16.MAX_ROOT_ENTRIES;
        await this.disk.write16(this._boot, 17, this._rootEntries);

        // Number of sectors on the file-system
        let numSectors = Math.floor(this.disk.size / this.disk.sectorSize);
        await this.disk.write16(this._boot, 19, numSectors);

        // Write the number of sectors per track
        await this.disk.write16(this._boot, 24, 12);

        // Number of heads
        await this.disk.write16(this._boot, 26, 1);

        // Number of hidden sectors
        await this.disk.write16(this._boot, 28, 0);

        // Logical drive number
        await this.disk.write16(this._boot, 36, 0);

        // 37, bit 0: Whether or not we need to scan the disk for errors

        // Extended signature
        await this.disk.write8(this._boot, 38, 0x29);

        // Serial number for partition (39-42)
        await this.disk.write32(this._boot, 39, 0xabcd);

        // Volume label
        await this.disk.writeString(this._boot, 43, "MAINDISK  ", 10);

        // Filesystem type
        await this.disk.writeString(this._boot, 43, "FAT16   ", 8);

        // Signature
        await this.disk.write16(this._boot, 510, 0xaa55);
    }

    async writeFAT() {
        // It is after the boot sector and reserved sector.
        this._fatIndex = 2;

        // Calculate the number of sectors the FAT takes up.
        this._fatSize = 0;

        // What is the remaining space?
        // We need to account for the 2 starting sectors and 9 bytes for the
        // first two entries in both FATs, which are metadata entries.
        let remaining = (this.disk.size - (this.disk.sectorSize * 2)) - 8;

        // Also account for the root directory
        remaining -= this._rootEntries * 32;

        // Each cluster takes up its cluster size and 2 bytes for the FAT entry
        // There are two FATs, so (clusterSize + 4) divided by remaining space.
        let numClusters = Math.floor(remaining / (this.clusterSize + 4));

        // Get the fat size
        this._fatSize = numClusters * 2;

        // Round the fat to the sector size
        let align = this.disk.sectorSize - 1;
        this._fatSize = (this._fatSize + align) & ~align;

        // Gather the number of sectors
        this._fatSectors = this._fatSize / this.disk.sectorSize;

        let calculated = (this._fatSize * 2) + (numClusters * this.clusterSize) + (this.disk.sectorSize * 2);
        if (calculated > this.disk.size) {
            numClusters--;
        }

        this._numClusters = numClusters;

        let rootSectors = this._rootEntries * 32;
        rootSectors = Math.floor(rootSectors / this.disk.sectorSize);
        this._firstSector = 2 + (this._fatSize * 2) + rootSectors;

        // Write the number of sectors per FAT
        await this.disk.write16(this._boot, 22, this._fatSectors);

        // Zero out both FATs
        for (let i = 0; i < this._fatSectors; i++) {
            for (let j = 0; j < this.disk.sectorSize; j += 4) {
                await this.disk.write32(i + 2, j, 0);
                await this.disk.write32(i + 2 + this._fatSectors, j, 0);
            }
        }

        // Write end-of-file markers
        await this.writeFATEntry(1, 0xffff);
    }

    /**
     * Writes a value into a FAT entry.
     *
     * @param {number} index - The index of the cluster.
     * @param {number} value - The 16-bit value to write.
     */
    async writeFATEntry(index, value) {
        let sector = 2 + Math.floor(index / this.disk.sectorSize);
        let offset = (index * 2) % this.disk.sectorSize;

        // Write to the first FAT
        await this.disk.write16(sector, offset, value);

        // Write to the second FAT
        await this.disk.write16(sector + this._fatSectors, offset, value);
    }

    async readFATEntry(index) {
        let sector = 2 + Math.floor(index / this.disk.sectorSize);
        let offset = (index * 2) % this.disk.sectorSize;

        // Read a FAT
        return await this.disk.read16(sector, offset);
    }

    /**
     * Retrieves the directory that contains the given path.
     */
    async open(path, create = false) {
        let current = new FAT16Directory({}, this._root, "", this);
        if (path.length > 1) {
            current = await this.open(path.slice(0, path.length - 1), create);

            if (!current) {
                return null;
            }
        }

        let name = path[path.length - 1];

        let info = await current.lookup(name);

        if (!info) {
            if (create) {
                // Add the directory to current

                // Allocate an entry for the directory file
                let inode = await this.allocate()

                // Write a 0 into the directory to 'empty' it.
                let sector = (inode - 2) * this.sectorsPerCluster;
                sector += this.firstSector;
                await this.disk.write8(sector, 0, 0);

                // Append the entry to the current directory
                await current.append({
                    inode: inode,
                    name: name,
                    size: 0,
                    directory: true,
                    readOnly: false,
                    hidden: false,
                    system: false,
                    volume: false,
                    archive: false,
                    time: {
                        hour: 10,
                        minute: 20,
                        second: 40
                    },
                    date: {
                        year: 2020,
                        month: 1,
                        day: 6
                    }
                });

                // Look it up again
                info = await current.lookup(name);
            }
        }

        return info;
    }

    /**
     * Creates the given, empty, file.
     */
    async create(path, options = {}) {
        // Interpret the directories and create a file entry
        return await this.map(path, new DataView((new Uint8Array(0)).buffer), options);
    }

    /**
     * Creates a file with the given data or stream.
     */
    async map(path, data, options = {}) {
        // Open each directory, creating as we go
        let directory = await this.open(path.slice(0, path.length - 1), true);

        // Allocate an inode for the beginning of the file
        let inode = await this.allocate();
        await this.writeFATEntry(inode, 0xffff);

        let info = {
            inode: inode,
            name: path[path.length - 1],
            size: data.byteLength,
            readOnly: !!options.readOnly,
            archive: !!options.archive,
            system: !!options.system,
            hidden: !!options.hidden,
            volume: !!options.volume,
            directory: false,
            time: {
                hour: 10,
                minute: 20,
                second: 40
            },
            date: {
                year: 2020,
                month: 1,
                day: 6
            }
        };

        // Add the file to the directory
        // TODO: allow passing a date/time via options
        //       default to current date/time.
        await directory.append(info);

        // Map every cluster into the disk from the data, allocating a node as
        // we go.
        let offset = 0;
        do {
            let sector = (inode - 2) * this.sectorsPerCluster;
            sector += this.firstSector;

            if (!data instanceof Stream) {
                await this.disk.write(sector, 0, new DataView(
                    data.slice(offset, offset + this.clusterSize)
                ));
            }
            else {
                this._streams[sector] = {
                    instance: data,
                    offset: offset
                };
            }

            offset += this.clusterSize;
            if (offset < data.byteLength) {
                let nextInode = await this.allocate();
                await this.writeFATEntry(inode, nextInode);
                inode = nextInode;
                await this.writeFATEntry(inode, 0xffff);
            }
        } while (offset < data.byteLength);
    }

    /**
     * Returns a directory listing for the given path.
     */
    async list(path) {
        let info = await this.open(path);
        // TODO: errors for invalid/unknown path
        return await info.list();
    }

    async info(path) {
        let info = await this.openPath(path);
        return info.info;
    }
}

export class FAT16File extends File {
    constructor(info, inode, path, fileSystem) {
        super(info);

        this._inode = inode;
        this._path = path;
        this._fileSystem = fileSystem;
    }

    get inode() {
        return this._inode;
    }

    get path() {
        return this._path;
    }

    get fileSystem() {
        return this._fileSystem;
    }

    get disk() {
        return this._fileSystem.disk;
    }

    async translate(offset) {
        let inode = this.inode;
        while (offset >= this.fileSystem.clusterSize) {
            // Get the entry at this inode.
            // It will point to the next cluster.
            // (Or, it will be an EOF marker)
            inode = await this.fileSystem.readFATEntry(inode);
            offset -= this.fileSystem.clusterSize;

            // 0xfff7 is a bad cluster, 0xfff8+ is EOF
            if (inode >= 0xfff7) {
                return null;
            }
        }

        let sector = (inode - 2) * this.fileSystem.sectorsPerCluster;
        sector += this.fileSystem.firstSector;

        return [sector, offset];
    }

    async read(offset, length) {
        if (offset + length > this.size) {
            length = this.size - offset;
        }

        let address = await this.translate(offset);
        let stream = this.fileSystem._streams[address[0]];
        if (stream) {
            return await stream.instance.read(offset, length);
        }

        // Craft a return by reading every cluster
        let ret = new Uint8Array(length);
        let position = 0;

        while (position < length) {
            if (position > 0) {
                address = await this.translate(offset);
            }
            let toRead = this.fileSystem.clusterSize - address[1];
            if ((position + toRead) > length) {
                toRead = length - position;
            }

            let bytes = await this.disk.read(address[0], address[1], toRead);
            ret.set(new Uint8Array(bytes), position);

            position += toRead;
            offset += toRead;
        }

        return ret;
    }

    async read8(offset) {
        let address = await this.translate(offset);
        let stream = this.fileSystem._streams[address[0]];
        if (stream) {
            return await stream.instance.read8(offset);
        }

        return this.disk.read8(address[0], address[1]);
    }

    async read16(offset, littleEndian = true) {
        let address = await this.translate(offset);
        let stream = this.fileSystem._streams[address[0]];
        if (stream) {
            return await stream.instance.read16(offset, littleEndian);
        }

        return this.disk.read16(address[0], address[1], littleEndian);
    }

    async read32(offset, littleEndian = true) {
        let address = await this.translate(offset);
        let stream = this.fileSystem._streams[address[0]];
        if (stream) {
            return await stream.instance.read32(offset, littleEndian);
        }

        return this.disk.read32(address[0], address[1], littleEndian);
    }

    async write8(offset, value) {
        let address = await this.translate(offset);
        // TODO: when address is null, we append a cluster to the file
        let stream = this.fileSystem._streams[address[0]];
        if (stream) {
            // We have to copy over the bytes, now, and not use the stream.
            let buffer = await stream.instance.read(stream.offset, this.clusterSize);
            await this.disk.write(address[0], 0, new DataView(buffer));
            delete this.fileSystem._streams[address[0]];
        }

        await this.disk.write8(address[0], address[1], value);
    }

    async write16(offset, value, littleEndian = true) {
        let address = await this.translate(offset);
        // TODO: when address is null, we append a cluster to the file
        let stream = this.fileSystem._streams[address[0]];
        if (stream) {
            // We have to copy over the bytes, now, and not use the stream.
            let buffer = await stream.instance.read(stream.offset, this.clusterSize);
            await this.disk.write(address[0], 0, new DataView(buffer));
            delete this.fileSystem._streams[address[0]];
        }

        await this.disk.write16(address[0], address[1], value, littleEndian);
    }

    async write32(offset, value, littleEndian = true) {
        let address = await this.translate(offset);
        // TODO: when address is null, we append a cluster to the file
        let stream = this.fileSystem._streams[address[0]];
        if (stream) {
            // We have to copy over the bytes, now, and not use the stream.
            let buffer = await stream.instance.read(stream.offset, this.clusterSize);
            await this.disk.write(address[0], 0, new DataView(buffer));
            delete this.fileSystem._streams[address[0]];
        }

        await this.disk.write32(address[0], address[1], value, littleEndian);
    }

    async readCString(offset, max) {
        let ret = "";

        let limit = 0;
        let current = null;
        do {
            current = await this.read8(offset);
            if (current) {
                ret = ret + String.fromCharCode(current);
            }
            offset++;
            limit++;
        } while(limit < max && current != 0);

        return ret;
    }

    async writeString(offset, value, max) {
        let i = 0;
        for ( ; i < max && i < value.length; i++) {
            let b = value.charCodeAt(i);
            await this.write8(offset, b);
            offset++;
        }

        if (i < max) {
            await this.write8(offset, 0);
        }
    }

    async writeCString(offset, value, max) {
        for (let i = 0; i < (max - 1) && i < value.length; i++) {
            let b = value.charCodeAt(i);
            await this.write8(offset, b);
            offset++;
        }

        if (max > 0) {
            await this.write8(offset, 0);
        }
    }
}

export class FAT16Directory extends FAT16File {
    constructor(info, inode, path, fileSystem) {
        super(info, inode, path, fileSystem);
    }

    async translate(offset) {
        if (this.path == "") {
            // Root directory has special circumstances.
            // The root directory is stored sequentially for the root sector.
            // The 'inode' specifies the first sector of the root directory.
            let sector = this.inode + Math.floor(offset / this.disk.sectorSize);
            return [sector, offset % this.disk.sectorSize];
        }
        else {
            return await super.translate(offset);
        }
    }

    async lookup(name) {
        let items = await this.list();

        for (let i = 0; i < items.length; i++) {
            let item = items[i];
            if (item.info.name.toUpperCase() == name.toUpperCase()) {
                return item;
            }
        }

        return null;
    }

    async append(info) {
        // Find an empty entry
        let i = 0;
        // TODO: is this a reasonable directory max size?
        while (i < FAT16.MAX_DIRECTORY_ENTRIES) {
            let b = await this.read8(i * 32);
            if (b == 0 || b == null) {
                break;
            }
            i++;
        }

        // 'i' is the next entry of the directory
        let offset = i * 32;

        // Write the entry.
        let name = info.name.split(".")[0];
        let ext = info.name.split(".")[1] || "";

        // Write name and extension
        await this.writeString(offset, name.padEnd(8, " "), 8);
        await this.writeString(offset + 8, ext.padEnd(3, " "), 3);

        // Craft flags
        let flags = 0;
        if (info.readOnly) {
            flags |= 0x1;
        }
        if (info.hidden) {
            flags |= 0x2;
        }
        if (info.system) {
            flags |= 0x4;
        }
        if (info.volume) {
            flags |= 0x8;
        }
        if (info.directory) {
            flags |= 0x10;
        }
        if (info.archive) {
            flags |= 0x20;
        }
        await this.write8(offset + 11, flags);
        
        // Craft timestamp (5/6/5 h/m/(s/2))
        let time = 0;
        time = (info.time.hour & 0x1f);
        time <<= 6;
        time |= (info.time.minute & 0x3f);
        time <<= 5;
        time |= Math.floor(info.time.second / 2) & 0x1f;
        await this.write16(offset + 22, time);
        
        // Craft datestamp (7/4/5 y-1980/m/d)
        let date = 0;
        date = (info.date.year - 1980) & 0x7f;
        date <<= 4;
        date |= (info.date.month & 0xf);
        date <<= 5;
        date |= (info.date.day & 0x1f);
        await this.write16(offset + 24, date);

        // Place inode
        await this.write16(offset + 26, info.inode);

        // Filesize
        await this.write32(offset + 28, info.size);

        // Ensure the following entry is empty
        // (if we aren't at the end of a sector)
        if ((offset + 32) % this.fileSystem.clusterSize != 0) {
            await this.write32(offset + 32, 0, 0);
        }
    }

    /**
     * Returns the directory listing.
     */
    async list() {
        // The return value
        let ret = [];

        // Read each entry
        for (let i = 0; i < 64; i++) {
            let b = await this.read8(i * 32);
            if (b == 0) {
                break;
            }

            let offset = i * 32;

            let filename = await this.readCString(offset, 11);
            // TODO: I think it can have spaces in the beginning
            filename = filename.substring(0, 8).trim() + "." +
                       filename.substring(8).trim();

            // Correct the special names '.' and '..'
            if (filename === "..") {
                filename = ".";
            }
            else if (filename === "...") {
                filename = "..";
            }
            else if (filename.endsWith(".")) {
                // Remove trailing '.'
                filename = filename.substring(0, filename.length - 1);
            }

            let flags = await this.read8(offset + 11);
            let time = await this.read16(offset + 22);
            let date = await this.read16(offset + 24);
            let size = await this.read32(offset + 28);
            let inode = await this.read16(offset + 26);
            let directory = (flags & 0x10) != 0;

            ret.push({
                name: filename,
                inode: inode,
                readOnly: (flags & 0x1) != 0,
                hidden: (flags & 0x2) != 0,
                system: (flags & 0x4) != 0,
                volume: (flags & 0x8) != 0,
                directory: directory,
                archive: (flags & 0x20) != 0,
                size: size,
                time: {
                    hour: time >> 11,
                    minute: (time >> 5) & 0x3f,
                    second: (time & 0x1f) * 2
                },
                date: {
                    year: (date >> 9) + 1980,
                    month: (date >> 5) & 0xf,
                    day: date & 0x1f
                }
            });
        }

        ret = ret.map( (info) => {
            if (info.directory) {
                return new FAT16Directory(info, info.inode, this.path + "\\" + info.name, this.fileSystem);
            }

            return new FAT16File(info, info.inode, this.path + "\\" + info.name, this.fileSystem);
        });

        return ret;
    }
}

// The maximum number of entries in a single directory
FAT16.MAX_DIRECTORY_ENTRIES = 1024;

// Maximum number of files/directories in the root directory
FAT16.MAX_ROOT_ENTRIES = 512;
