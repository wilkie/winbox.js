import { getDescriptor } from './dpmi/getDescriptor.js';

import { I286 } from '../emulator/core/i286.js';
import { I386 } from '../emulator/core/i386.js';

export class DPMI {
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

            // LDT Management Services

            // 0x0000: Allocate LDT
            // 0x0001: Free LDT
            // 0x0002: Map Real-Mode Segment to Descriptor
            // 0x0003: Get Selector Increment Value
            // 0x0006: Get Segment Base Address
            // 0x0007: Set Segment Base Address
            // 0x0008: Set Segment Limit
            // 0x0009: Set Descriptor Access Rights
            // 0x000a: Create Alias Descriptor
            // 0x000b: Get Descriptor
            0x000b: [getDescriptor, [[I286.REGISTER_BX, 2, Number],
                                     [[I286.REGISTER_ES, I386.REGISTER_EDI], 4, Number]], [], false],

            // 0x000c: Set Descriptor
            // 0x000d: Allocate Specific LDT Descriptor
            // 0x000e: Get Multiple Descriptors
            // 0x000f: Set Multiple Descriptors

            // DOS Memory Management Services

            // 0x0100: Allocate DOS Memory Block
            // 0x0101: Free DOS Memory Block
            // 0x0102: Resize DOS Memory Block

            // Interrupt Management Services

            // 0x0200: Get Real Mode Interrupt Vector
            // 0x0201: Set Real Mode Interrupt Vector
            // 0x0202: Get Processor Exception Handler Vector
            // 0x0203: Set Processor Exception Handler Vector
            // 0x0204: Get Protected Mode Interrupt Vector
            // 0x0205: Set Protected Mode Interrupt Vector
            // 0x0210: Get Extended Processor Exception Handler Vector In
            //         Protected Mode
            // 0x0211: Get Extended Processor Exception Handler Vector In
            //         Real Mode
            // 0x0212: Set Extended Processor Exception Handler Vector In
            //         Protected Mode
            // 0x0213: Set Extended Processor Exception Handler Vector In
            //         Real Mode
            // 0x0900: Get and Disable Virtual Interrupt State
            // 0x0901: Get and Enable Virtual Interrupt State
            // 0x0902: Get Virtual Interrupt State

            // Translation Services

            // 0x0300: Simulate Real Mode Interrupt
            // 0x0301: Call Real Mode Procedure with Far Return Frame
            // 0x0302: Call Real Mode Procedure with Interrupt Return Frame
            // 0x0303: Allocate Real Mode Callback Address
            // 0x0304: Free Real Mode Callback Address
            // 0x0305: Get State Save/Restore Addresses
            // 0x0306: Get Raw CPU Mode Switch Addresses

            // Extended Memory Management Services

            // 0x0500: Get Free Memory Information
            // 0x0501: Allocate Memory Block
            // 0x0502: Free Memory Block
            // 0x0503: Resize Memory Block
            // 0x0504: Allocate Linear Memory Block
            // 0x0505: Resize Linear Memory Block
            // 0x0506: Get Page Attributes
            // 0x0507: Set Page Attributes
            // 0x0508: Map Device in Memory Block
            // 0x0509: Map Conventional Memory in Memory Block
            // 0x050a: Get Memory Block Size and Base
            // 0x050b: Get Memory Information
            // 0x0800: Physical Address Mapping
            // 0x0801: Free Physical Address Mapping
            // 0x0d00: Allocate Shared Memory
            // 0x0d01: Free Shared Memory
            // 0x0d02: Serialize on Shared Memory
            // 0x0d03: Free Serialization on Shared Memory

            // Page Management Services

            // 0x0600: Lock Linear Region
            // 0x0601: Unlock Linear Region
            // 0x0602: Mark Real Mode Region as Pageable
            // 0x0603: Relock Real Mode Region
            // 0x0604: Get Page Size
            // 0x0702: Mark Page as Demand Paging Candidate
            // 0x0703: Discard Page Contents

            // Debug Support Services

            // 0x0b00: Set Debug Watchpoint
            // 0x0b01: Clear Debug Watchpoint
            // 0x0b02: Get State of Debug Watchpoint
            // 0x0b03: Reset Debug Watchpoint
        };
    }

    invoke() {
        // A DOS/bios call
        console.log(
            "dos DPMI called from:",
            this._machine.cpu.core.cs.toString(16), ':',
            this._machine.cpu.core.ip.toString(16),
            'ah=', this._machine.cpu.core.ah.toString(16) + 'h',
            'al=', this._machine.cpu.core.al.toString(16) + 'h',
            'bx=', this._machine.cpu.core.bx.toString(16),
            'cx=', this._machine.cpu.core.cx.toString(16),
            'ds=', this._machine.cpu.core.ds.toString(16),
            'dx=', this._machine.cpu.core.dx.toString(16)
        );

        const handler = this._exports[this._machine.cpu.core.ax];

        if (handler) {
            // Read arguments
            const args = [];

            handler[1].forEach( (arg) => {
                let type = arg[2];
                let value = 0;
                if (arg[0] instanceof Array) {
                    // Segment:Offset pair
                    type = arg[1];
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
            const ret = func.bind(this._dos)(...args);

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
                    this._machine.cpu.core.writeRegister16(returnType[0][0], value);
                }
                else if (returnType[1] == 1) {
                    this._machine.cpu.core.writeRegister8(returnType[0], value);
                }
                else {
                    this._machine.cpu.core.writeRegister16(returnType[0], value);
                }

                position++;
            });

            const errorFlag = handler[3] || false;
            if (errorFlag) {
                // on error, set carry
                //this._machine.cpu.core.flags.carry = true;
            }
        }
        else {
            console.log(
                "error: Unknown DOS call",
                this._machine.cpu.core.ax.toString(16)
            );
        }
    }
}
