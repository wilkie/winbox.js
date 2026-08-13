import { chdir } from './syscall/chdir.js';
import { close } from './syscall/close.js';
import { exit } from './syscall/exit.js';
import { getDate } from './syscall/getDate.js';
import { getInterruptVector } from './syscall/getInterruptVector.js';
import { getTime } from './syscall/getTime.js';
import { getVersion } from './syscall/getVersion.js';
import { open } from './syscall/open.js';
import { read } from './syscall/read.js';
import { seek } from './syscall/seek.js';
import { selectDisk } from './syscall/selectDisk.js';
import { setInterruptVector } from './syscall/setInterruptVector.js';

import { I286 } from '../emulator/core/i286.js';

export class SyscallManager {
    declare _dos: any;
    declare _exports: any;
    declare _machine: any;
    constructor(dos) {
        this._dos = dos;
        this._machine = dos._machine;
        this._exports = this.exports;
    }

    get exports() {
        return {
            // INDEX: [ func, [ args ], [ return registers ], set CF on error? ],

            // 0x00: program terminate
            // 0x01: keyboard input
            // 0x02: display output
            // 0x03: aux input
            // 0x04: aux output
            // 0x05: printer output
            // 0x06: direct console i/o character output
            // 0x07: direct console i/o character input
            // 0x08: direct stdin input, no echo
            // 0x09: print string
            // 0x0a: buffered keyboard input
            // 0x0b: check standard input status
            // 0x0c: clear keyboard buffer
            // 0x0d: disk reset

            // select disk
            0x0e: [selectDisk, [[I286.REGISTER_DL, 1, Number]], [], false],

            // 0x0f: open disk file
            // 0x10: close disk file
            // 0x11: search first using FCB
            // 0x12: search next using FCB
            // 0x13: delete file via FCB
            // 0x14: sequential disk file read
            // 0x15: sequential disk file write
            // 0x16: create disk file
            // 0x17: rename file via FCB
            // 0x18: (internal) unused
            // 0x19: get default disk number
            // 0x1a: set disk transfer area address
            // 0x1b: allocation table information
            // 0x1c: allocation table information for specific device
            // 0x1d: (internal) unused
            // 0x1e: (internal) unused
            // 0x1f: (internal) get default drive parameters block
            // 0x20: (internal) unused
            // 0x21: random disk read
            // 0x22: random disk write
            // 0x23: get file size
            // 0x24: set random record field

            // Set interrupt vector
            // AL: Interrupt vector index
            // DS:DX: Address of vector
            0x25: [setInterruptVector, [[I286.REGISTER_AL, 1, Number],
                                        [[I286.REGISTER_DS, I286.REGISTER_DX], 2, Number]],
                                       [], false],

            // 0x26: create psp
            // 0x27: random block read
            // 0x28: random block write
            // 0x29: parse filename

            // Get current date
            // CX <- year
            // DH <- month
            // DL <- day
            // AL <- day of the week (0 sunday, 1 monday, etc)
            0x2a: [getDate, [],
                            [[I286.REGISTER_CX, 2],
                             [I286.REGISTER_DH, 1],
                             [I286.REGISTER_DL, 1],
                             [I286.REGISTER_AL, 1]], false],

            // 0x2b: set current date

            // Get current time
            // CH <- hour
            // CL <- minute
            // DH <- seconds
            // DL <- hundreds of seconds
            0x2c: [getTime, [],
                            [[I286.REGISTER_CH, 1],
                             [I286.REGISTER_CL, 1],
                             [I286.REGISTER_DH, 1],
                             [I286.REGISTER_DL, 1]], false],

            // 0x2d: set current time
            // 0x2e: set verify flag
            // 0x2f: get disk transfer area address

            // Get dos version
            0x30: [getVersion, [],
                               [[I286.REGISTER_AX, 2],
                                [I286.REGISTER_BX, 2],
                                [I286.REGISTER_CX, 2]], false],

            // 0x31: terminate but stay resident
            // 0x32: get drive parameter block
            // 0x33: extended control-break checking
            // 0x34: (internal )return CritSectFlag pointer
            // Get interrupt vector
            // AL: Interrupt vector index
            0x35: [getInterruptVector, [[I286.REGISTER_AL, 1, Number]],
                                       [[[I286.REGISTER_ES, I286.REGISTER_BX]]], false],

            // 0x36: get disk space
            // 0x37: (internal) switchar/availdev
            // 0x38: get country-dependent information
            // 0x39: create subdirectory (mkdir)
            // 0x3a: remove directory entry (rmdir)

            // Change current directory
            // DS:DX: Directory path
            // CF set on error
            // AX <- error code
            0x3b: [chdir, [[[I286.REGISTER_DS, I286.REGISTER_DX], 2, String]],
                          [[I286.REGISTER_AX, 2]], true],

            // 0x3c: create file with handle (creat)
            // Open disk file with handle
            // DS:DX: File path
            // AL: Access (0: read-only, 1: write-only, 2: read/write)
            // CF set on error
            // AX <- error code (on error)
            // AX <- file handle
            0x3d: [open, [[[I286.REGISTER_DS, I286.REGISTER_DX], 2, String],
                          [I286.REGISTER_AL, 1, Number]],
                          [[I286.REGISTER_AX, 2]], true],

            // 0x3e: close file with handle
            // BX: File handle
            // CF set on error
            // AX <- error code (on error)
            0x3e: [close, [[I286.REGISTER_BX, 2, Number]],
                          [], true],

            // Read from file with handle
            // DS:DX: address of buffer
            // BX: File handle
            // CX: Number of bytes to read
            // CF set on error
            // AX <- error code (on error)
            // AX <- number of bytes read
            0x3f: [read, [[I286.REGISTER_BX, 2, Number],
                          [[I286.REGISTER_DS, I286.REGISTER_DX], 2, Number],
                          [I286.REGISTER_CX, 2, Number]],
                          [[I286.REGISTER_AX, 2]], true],

            // 0x40: write to file with handle
            // 0x41: delete a file (unlink)
            // 0x42: move file read/write pointer (lseek)
            // BX: File handle
            // AL: Method (0: from beginning, 1: from current, 2: from end)
            // CX:DX: offset in bytes
            // CF set on error
            // AX <- error code (on error)
            // DX:AX <- new offset
            0x42: [seek, [[I286.REGISTER_BX, 2, Number],
                          [I286.REGISTER_CX, 2, Number],
                          [I286.REGISTER_DX, 2, Number],
                          [I286.REGISTER_AL, 1, Number]],
                          [[I286.REGISTER_DX, 2],
                           [I286.REGISTER_AX, 2]], true],

            // 0x43: get/put file attributes (chmod)
            // 0x4400: get device information
                        // BX: device handle
                        // AX <- error code
                        // DX <- device info
                        // CF set on error
            // 0x4401: set device information
                        // BX: device handle
                        // DH: 0
                        // DL: device info to set
                        // CF set on error
            // 0x4402: read character device control string
            // 0x4404: read block device control string
            // 0x4405: write block device control string
            // 0x4406: get input status
            // 0x4407: get output status
            // 0x4408: block device changeable
            // 0x4409: block device local
            // 0x440a: handle local
            // 0x440b: set sharing retry count
            // 0x440c: generic
            // 0x440d: block device request
            // 0x440e: get logical drive map
            // 0x440f: set logical drive map
            // 0x45: create duplicate handle (dup)
            // 0x46: force duplicate handle (forcdup, dup2)
            // 0x47: get current directory (pwd)
            // 0x48: allocate memory
            // 0x49: free memory
            // 0x4a: adjust memory block size (setblock)
            // 0x4b: load or execute (exec)

            // Exit
            0x4c: [exit, [], [], false],

            // 0x4d: get exit code of subprogram (wait)
            // 0x4e: find first asciz (find first)
            // 0x4f: find next asciz (find next)
            // 0x50: (internal) set PSP segment
            // 0x51: (internal) get PSP segment
            // 0x52: (internal) get list of lists
            // 0x53: (internal) translate BPB
            // 0x54: get verify flag
            // 0x55: (internal) create PSP
            // 0x56: rename file (rename)
            // 0x57: get/set time/date
            // 0x58: get/set memory allocation strategy
            // 0x59: get extended error code
            // 0x5a: create unique file
            // 0x5b: create new file
            // 0x5c: lock/unlock file access
            // 0x5d00: (internal) ???
            // 0x5d06: (internal) get address of critical error flag
            // 0x5d0a: (internal) set extended error information
            // 0x5e00: (network) get machine name
            // 0x5e01: (network) set machine name
            // 0x5e02: (network) set printer setup
            // 0x5e03: (network) get printer setup
            // 0x5f02: (network) get redirection list entry
            // 0x5f03: (network) redirect device
            // 0x5f04: (network) cancel redirection
            // 0x60: (internal) resolve path string to fully qualified path
            // 0x61: (internal) unused (sets AL to 0)
            // 0x62: (internal) get PSP address
            // 0x63: (internal) get lead byte table
            // 0x65: get extended country information
            // 0x66: get/set global code page table
            // 0x67: set handle count
            // 0x68: commit file write all buffered data to disk
            // 0x6c00: extended open/create
            // 0xb6: (novell netware) extended file attributes
            // 0xb8: (novell netware) print jobs
            // 0xbb: (novell netware) set end of job status
            // 0xbc: (novell netware) log physical record
            // 0xbd: (novell netware) release physical record
            // 0xbe: (novell netware) clear physical record
        };
    }

    invoke() {
        // A DOS/bios call
        console.log(
            "dos syscall called from:",
            this._machine.cpu.core.cs.toString(16), ':',
            this._machine.cpu.core.ip.toString(16),
            'ah=', this._machine.cpu.core.ah.toString(16) + 'h',
            'al=', this._machine.cpu.core.al.toString(16) + 'h',
            'bx=', this._machine.cpu.core.bx.toString(16),
            'cx=', this._machine.cpu.core.cx.toString(16),
            'ds=', this._machine.cpu.core.ds.toString(16),
            'dx=', this._machine.cpu.core.dx.toString(16)
        );

        let handler = this._exports[this._machine.cpu.core.ah];
        if (!handler) {
            handler = this._exports[this._machine.cpu.core.ax];
        }

        if (handler) {
            // Read arguments
            const args = [];

            handler[1].forEach( (arg) => {
                let type = arg[2];
                let value = 0;
                if (arg[0] instanceof Array) {
                    // Segment:Offset pair
                    type = arg[2];
                    const segment = this._machine.cpu.core.readSegmentRegister(arg[0][0]);
                    let offset = 0;
                    if (arg[1] == 1) {
                        offset = this._machine.cpu.core.readRegister8(arg[0][1]);
                    }
                    else if (arg[1] == 2) {
                        offset = this._machine.cpu.core.readRegister16(arg[0][1]);
                    }
                    else if (arg[1] == 4) {
                        offset = this._machine.cpu.core.readRegister32(arg[0][1]);
                    }
                    value = this._machine.cpu.core.translateAddress(segment, offset);
                }
                else {
                    if (arg[1] == 1) {
                        value = this._machine.cpu.core.readRegister8(arg[0]);
                    }
                    else {
                        value = this._machine.cpu.core.readRegister16(arg[0]);
                    }
                }

                if (type === String) {
                    // Read string from address
                    value = this._machine.memory.readCString(value);
                }

                args.push(value);
            });

            // Call handler
            const func = handler[0];
            const result = func.bind(this._dos)(...args);

            function interpretReturn(ret) {
                if (!(ret instanceof Array)) {
                    ret = [ret];
                }

                // Return values
                const returns = handler[2];
                let position = 0;
                returns.forEach( (returnType) => {
                    let value = ret[position];

                    if (returnType[0] instanceof Array) {
                        // segment:offset pair
                        this._machine.cpu.core.writeSegmentRegister(returnType[0][0], value);
                        position++;
                        value = ret[position];
                        this._machine.cpu.core.writeRegister8(returnType[0][0], value);
                    }
                    else if (returnType[1] == 1) {
                        this._machine.cpu.core.writeRegister8(returnType[0], value);
                    }
                    else {
                        this._machine.cpu.core.writeRegister16(returnType[0], value);
                    }

                    position++;
                });
            }

            const errorFlag = handler[3] || false;

            if (result instanceof Promise) {
                return new Promise( (resolve) => {
                    result.then( (subResult) => {
                        interpretReturn.bind(this)(subResult);
                        resolve(true);
                    }).catch( (error) => {
                        if (errorFlag) {
                            // on error, set carry
                            this._machine.cpu.core.flags.carry = true;
                            this._machine.cpu.core.ax = error;
                        }
                        resolve(true);
                    });
                });
            }
            else {
                try {
                    interpretReturn.bind(this)(result);
                }
                catch (error) {
                    if (errorFlag) {
                        // on error, set carry
                        this._machine.cpu.core.flags.carry = true;
                        this._machine.cpu.core.ax = error;
                    }
                }
                return true;
            }
        }
        else {
            console.log(
                "error: Unknown DOS call",
                this._machine.cpu.core.ax.toString(16)
            );
            return true;
        }
    }
}
