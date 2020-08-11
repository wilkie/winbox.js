"use strict";

import { ALU } from './alu.js';

/**
 * This class represents the CPU emulation.
 */
export class CPU {
    constructor(memory, options = {}) {
        this._memory = memory;
        this._registers = new Array(8);
        this._segmentRegisters = new Array(4);
        this._alu = new ALU(this);

        this._interruptHandlers = new Array(128);

        this.reset();
    }

    /**
     * Retrieves the ALU for this CPU.
     */
    get alu() {
        return this._alu;
    }

    /**
     * Retrieves the Memory instance being used by this CPU.
     */
    get memory() {
        return this._memory;
    }

    /**
     * Retrieves the segment assigned to the interrupt descriptor table.
     */
    get idt() {
        return this._idt;
    }

    /**
     * Sets the selector to use for the interrupt descriptor table.
     *
     * @param {number} value - The segment selector index to use.
     */
    set idt(value) {
        this._idt = value;
    }

    /**
     * Retrieves the current value of the CS register.
     */
    get cs() {
        return this._segmentRegisters[CPU.REGISTER_CS];
    }

    /**
     * Sets the CS register to the given value.
     *
     * @param {number} value - The new value for this register.
     */
    set cs(value) {
        // TODO: check that the segment is executable and raise interrupt if not
        this._segmentRegisters[CPU.REGISTER_CS] = value;
    }

    /**
     * Retrieves the current value of the IP register.
     */
    get ip() {
        return this._ip;
    }

    /**
     * Sets the IP register to the given value.
     *
     * @param {number} value - The new value for this register.
     */
    set ip(value) {
        this._ip = value & 0xffff;
    }

    /**
     * Retrieves the current value of the AL register.
     */
    get al() {
        return this.readRegister8(CPU.REGISTER_AL);
    }

    /**
     * Sets the AL register to the given value.
     *
     * @param {number} value - The new value for this register.
     */
    set al(value) {
        this.writeRegister8(CPU.REGISTER_AL, value);
    }

    /**
     * Retrieves the current value of the BL register.
     */
    get bl() {
        return this.readRegister8(CPU.REGISTER_BL);
    }

    /**
     * Sets the BL register to the given value.
     *
     * @param {number} value - The new value for this register.
     */
    set bl(value) {
        this.writeRegister8(CPU.REGISTER_BL, value);
    }

    /**
     * Retrieves the current value of the CL register.
     */
    get cl() {
        return this.readRegister8(CPU.REGISTER_CL);
    }

    /**
     * Sets the DL register to the given value.
     *
     * @param {number} value - The new value for this register.
     */
    set cl(value) {
        this.writeRegister8(CPU.REGISTER_CL, value);
    }

    /**
     * Retrieves the current value of the DL register.
     */
    get dl() {
        return this.readRegister8(CPU.REGISTER_DL);
    }

    /**
     * Sets the DL register to the given value.
     *
     * @param {number} value - The new value for this register.
     */
    set dl(value) {
        this.writeRegister8(CPU.REGISTER_DL, value);
    }

    /**
     * Retrieves the current value of the AH register.
     */
    get ah() {
        return this.readRegister8(CPU.REGISTER_AH);
    }

    /**
     * Sets the AH register to the given value.
     *
     * @param {number} value - The new value for this register.
     */
    set ah(value) {
        this.writeRegister8(CPU.REGISTER_AH, value);
    }

    /**
     * Retrieves the current value of the BH register.
     */
    get bh() {
        return this.readRegister8(CPU.REGISTER_BH);
    }

    /**
     * Sets the BH register to the given value.
     *
     * @param {number} value - The new value for this register.
     */
    set bh(value) {
        this.writeRegister8(CPU.REGISTER_BH, value);
    }

    /**
     * Retrieves the current value of the CH register.
     */
    get ch() {
        return this.readRegister8(CPU.REGISTER_CH);
    }

    /**
     * Sets the DH register to the given value.
     *
     * @param {number} value - The new value for this register.
     */
    set ch(value) {
        this.writeRegister8(CPU.REGISTER_CH, value);
    }

    /**
     * Retrieves the current value of the DH register.
     */
    get dh() {
        return this.readRegister8(CPU.REGISTER_DH);
    }

    /**
     * Sets the DH register to the given value.
     *
     * @param {number} value - The new value for this register.
     */
    set dh(value) {
        this.writeRegister8(CPU.REGISTER_DH, value);
    }

    /**
     * Retrieves the current value of the AX register.
     */
    get ax() {
        return this._registers[CPU.REGISTER_AX];
    }

    /**
     * Sets the AX register to the given value.
     *
     * @param {number} value - The new value for this register.
     */
    set ax(value) {
        this._registers[CPU.REGISTER_AX] = value;
    }

    /**
     * Retrieves the current value of the BX register.
     */
    get bx() {
        return this._registers[CPU.REGISTER_BX];
    }

    /**
     * Sets the BX register to the given value.
     *
     * @param {number} value - The new value for this register.
     */
    set bx(value) {
        this._registers[CPU.REGISTER_BX] = value;
    }

    /**
     * Retrieves the current value of the CX register.
     */
    get cx() {
        return this._registers[CPU.REGISTER_CX];
    }

    /**
     * Sets the CX register to the given value.
     *
     * @param {number} value - The new value for this register.
     */
    set cx(value) {
        this._registers[CPU.REGISTER_CX] = value;
    }

    /**
     * Retrieves the current value of the DX register.
     */
    get dx() {
        return this._registers[CPU.REGISTER_DX];
    }

    /**
     * Sets the DX register to the given value.
     *
     * @param {number} value - The new value for this register.
     */
    set dx(value) {
        this._registers[CPU.REGISTER_DX] = value;
    }

    /**
     * Retrieves the current value of the SS register.
     */
    get ss() {
        return this._segmentRegisters[CPU.REGISTER_SS];
    }

    /**
     * Sets the SS register to the given value.
     *
     * @param {number} value - The new value for this register.
     */
    set ss(value) {
        this._segmentRegisters[CPU.REGISTER_SS] = value;
    }

    /**
     * Retrieves the current value of the SP register.
     */
    get sp() {
        return this._registers[CPU.REGISTER_SP];
    }

    /**
     * Sets the SP register to the given value.
     *
     * @param {number} value - The new value for this register.
     */
    set sp(value) {
        this._registers[CPU.REGISTER_SP] = value;
    }

    /**
     * Retrieves the current value of the SI register.
     */
    get si() {
        return this._registers[CPU.REGISTER_SI];
    }

    /**
     * Sets the SI register to the given value.
     *
     * @param {number} value - The new value for this register.
     */
    set si(value) {
        this._registers[CPU.REGISTER_SI] = value;
    }

    /**
     * Retrieves the current value of the DS register.
     */
    get ds() {
        return this._segmentRegisters[CPU.REGISTER_DS];
    }

    /**
     * Sets the DS register to the given value.
     *
     * @param {number} value - The new value for this register.
     */
    set ds(value) {
        this._segmentRegisters[CPU.REGISTER_DS] = value;
    }

    /**
     * Retrieves the current value of the DI register.
     */
    get di() {
        return this._registers[CPU.REGISTER_DI];
    }

    /**
     * Sets the DI register to the given value.
     *
     * @param {number} value - The new value for this register.
     */
    set di(value) {
        this._registers[CPU.REGISTER_DI] = value;
    }

    /**
     * Retrieves the current value of the ES register.
     */
    get es() {
        return this._segmentRegisters[CPU.REGISTER_ES];
    }

    /**
     * Sets the ES register to the given value.
     *
     * @param {number} value - The new value for this register.
     */
    set es(value) {
        this._segmentRegisters[CPU.REGISTER_ES] = value;
    }

    /**
     * Retrieves the current value of the BP register.
     */
    get bp() {
        return this._registers[CPU.REGISTER_BP];
    }

    /**
     * Sets the BP register to the given value.
     *
     * @param {number} value - The new value for this register.
     */
    set bp(value) {
        this._registers[CPU.REGISTER_BP] = value;
    }

    /**
     * Retrieves the current value of the F register.
     *
     * The FLAGS is a bitfield. Each of the following bits represents the
     * following flag:
     *
     * 0:  Carry
     * 1:  N/A
     * 2:  Parity
     * 3:  N/A
     * 4:  Auxiliary Carry
     * 5:  N/A
     * 6:  Zero
     * 7:  Signed
     * 8:  Trap
     * 9:  Interrupt Enable
     * 10: Direction
     * 11: Overflow
     * 12-13: I/O Privilege Level (IOPL)
     * 14: Nested Task Flag
     */
    get f() {
        let f = 0;

        // Non-privileged control flags
        f = this._flags.carry ? (f | 0x01) : f;
        f = this._flags.parity ? (f | 0x04) : f;
        f = this._flags.auxiliaryCarry ? (f | 0x10) : f;
        f = this._flags.zero ? (f | 0x40) : f;
        f = this._flags.signed ? (f | 0x80) : f;

        // Privileged flags
        f = this._flags.trap ? (f | 0x100) : f;
        f = this._flags.interruptEnable ? (f | 0x200) : f;

        // More control flags
        f = this._flags.direction ? (f | 0x400) : f;
        f = this._flags.overflow ? (f | 0x800) : f;
        f = this._flags.nestedTask ? (f | 0x4000) : f;

        // The IOPL
        f = f | (this._flags.iopl << 12);

        return f;
    }

    /**
     * Sets the F register to the given value.
     *
     * @param {number} value - The new value for this register.
     */
    set f(value) {
        // Expand flags
        this._flags = {
            overflow: (value & 0x800) != 0,
            signed: (value & 0x80) != 0,
            parity: (value & 0x04) != 0,
            zero: (value & 0x40) != 0,
            auxiliaryCarry: (value & 0x10) != 0,
            carry: (value & 0x01) != 0,
            trap: (value & 0x100) != 0,
            direction: (value & 0x400) != 0,
            interruptEnable: (value & 0x200) != 0,
            nestedTask: (value & 0x4000) != 0,
            iopl: (value >> 12) & 0x3
        };
    }

    /**
     * Retrieves the CPU flags.
     */
    get flags() {
        return this._flags;
    }

    /**
     * Resets the CPU.
     */
    reset() {
        // Reset cycle count
        this._cycleCount = 0;

        // Reset logical CPU FLAGS
        this.f = 0;

        // Clear general registers
        this._registers.forEach( (_, i) => {
            this._registers[i] = 0;
        });

        // Clear segment registers
        this._segmentRegisters.forEach( (_, i) => {
            this._segmentRegisters[i] = 0;
        });

        // Clear IP
        this.ip = 0;

        // Clear the IDT
        this.idt = 0;
    }

    /**
     * Performs a CPU step.
     */
    step() {
        // Fetch / Decode
        let instruction = this.decode();

        // Execute
        this.execute(instruction);

        // Just increment the cycle count
        this._cycleCount++;
    }

    /**
     * Decodes the next instruction.
     */
    decode() {
        let instruction = {}

        // Read a 8-bit byte from memory at the current instruction pointer
        instruction.opcode = this._memory.read8(this.cs, this.ip);
        this.ip++;

        // Number of immediate bytes to read (to be determined)
        let immediateBytes = 0;

        // Decode possible two-byte opcodes
        switch(instruction.opcode) {
            case 0x0f:    // LGDT (Load Global Descriptor Table Register) /
                          // SGDT (Store Global Descriptor Table Register) /
                          // LIDT (Load Interrupt Descriptor Table Register) /
                          // SIDT (Store Interrupt Descriptor Table Register) /
                          // LLDT (Load Local Descriptor Table Register) /
                          // SLDT (Store Local Descriptor Table Register) /
                          // LMSW (Load Machine Status Word) /
                          // SMSW (Store Machine Status Word) /
                          // LSL  (Load Segment Limit) /
                          // LTR  (Load Task Register) /
                          // STR  (Store Task Register) /
                          // LAR  (Load Access Rights Byte) /
                          // VERR ew / VERW ew (Verify Read/Write of Segment)
                // Read the next byte
                instruction.immediate = this._memory.read8(this.cs, this.ip);

                if (instruction.immediate == 0x00 ||
                    instruction.immediate == 0x01 ||
                    instruction.immediate == 0x02 ||
                    instruction.immediate == 0x03) {
                    // Consume that byte
                    this.ip++;

                    // Retain the real opcode
                    instruction.subOpcode = instruction.opcode;

                    // Force to a special R-Type opcode, for internal decoding
                    instruction.opcode = 0x100;
                }

                break;

            case 0xf6:    // TEST eb,db
            case 0xf7:    // TEST ew,dw
                // Read the next byte as a ModRM value
                let modRM = this._memory.read8(this.cs, this.ip);

                // The R field is what we check
                let r = (modRM >> 3) & 0x7;

                if (r == 0x00) {
                    // TEST instruction
                    // (We do not consume the byte above. we will pull it again)

                    // Retain the real opcode
                    instruction.subOpcode = instruction.opcode;

                    // Force to a special R-Type opcode, for internal decoding
                    if (instruction.subOpcode == 0xf6) {
                        // Read 8-bit immediate
                        instruction.opcode = 0x200;
                    }
                    else {
                        // Read 16-bit immediate
                        instruction.opcode = 0x400;
                    }
                }

            default:
                break;
        }

        // Interpret the instruction to decode further
        switch (instruction.opcode) {
            // Prefixes (recursively decode)
            case 0x26:    // ES Override Prefix
                //console.log("es     es=", this.es);
                instruction = this.decode();
                instruction.segment = this.es;
                return instruction;

            case 0x2e:    // CS Override Prefix
                //console.log("cs     cs=", this.cs);
                instruction = this.decode();
                instruction.segment = this.cs;
                return instruction;

            case 0x36:    // SS Override Prefix
                //console.log("ss     ss=", this.ss);
                instruction = this.decode();
                instruction.segment = this.ss;
                return instruction;

            case 0x3e:    // DS Override Prefix
                //console.log("ds     ds=", this.ds);
                instruction = this.decode();
                instruction.segment = this.ds;
                return instruction;

            case 0x66:    // Operand-size/Precision-size override Prefix
                let operandSizeOverride = this._memory.read8(this.cs, this.ip);
                this.ip++;
                instruction = this.decode();
                instruction.operandSizeOverride = operandSizeOverride;
                return instruction;

            case 0x67:    // Address-size override Prefix
                let addressSizeOverride = this._memory.read8(this.cs, this.ip);
                this.ip++;
                instruction = this.decode();
                instruction.addressSizeOverride = addressSizeOverride;
                return instruction;

            case 0xf0:    // LOCK Prefix
                instruction = this.decode();
                instruction.lock = true;
                return instruction;

            case 0xf2:    // REPNE Prefix
                instruction = this.decode();
                instruction.repeatNE = true;
                instruction.repeat = true;
                return instruction;

            case 0xf3:    // REP / REPE Prefix
                instruction = this.decode();
                instruction.repeatE = true;
                instruction.repeat = true;
                return instruction;

            // Single byte opcode instructions
            case 0x06:    // PUSH ES
            case 0x07:    // POP ES
            case 0x0e:    // PUSH CS
            case 0x16:    // PUSH SS
            case 0x17:    // POP SS
            case 0x1e:    // PUSH DS
            case 0x1f:    // POP DS
            case 0x27:    // DAA (Decimal Adjust AL After Addition)
            case 0x2f:    // DAS (Decimal Adjust AL After Subtraction)
            case 0x37:    // AAA (ASCII Adjust AL After Addition)
            case 0x3f:    // AAS (ASCII Adjust AL After Subtraction)
            case 0x40:    // INC AX
            case 0x41:    // INC CX
            case 0x42:    // INC DX
            case 0x43:    // INC BX
            case 0x44:    // INC SP
            case 0x45:    // INC BP
            case 0x46:    // INC SI
            case 0x47:    // INC DI
            case 0x48:    // DEC AX
            case 0x49:    // DEC CX
            case 0x4a:    // DEC DX
            case 0x4b:    // DEC BX
            case 0x4c:    // DEC SP
            case 0x4d:    // DEC BP
            case 0x4e:    // DEC SI
            case 0x4f:    // DEC DI
            case 0x50:    // PUSH AX
            case 0x51:    // PUSH CX
            case 0x52:    // PUSH DX
            case 0x53:    // PUSH BX
            case 0x54:    // PUSH SP
            case 0x55:    // PUSH BP
            case 0x56:    // PUSH SI
            case 0x57:    // PUSH DI
            case 0x58:    // POP AX
            case 0x59:    // POP CX
            case 0x5a:    // POP DX
            case 0x5b:    // POP BX
            case 0x5c:    // POP SP
            case 0x5d:    // POP BP
            case 0x5e:    // POP SI
            case 0x5f:    // POP DI
            case 0x60:    // PUSHA
            case 0x61:    // POPA
            case 0x6c:    // INS eb,DX / INSB
            case 0x6d:    // INS ew,DX / INSW
            case 0x6e:    // OUTS DX,eb / OUTSB
            case 0x6f:    // OUTS DX,ew / OUTSW
            case 0x90:    // NOP (No Operation) / XCHG AX,AX
            case 0x91:    // XCHG AX,CX / XCHG CX,AX
            case 0x92:    // XCHG AX,DX / XCHG DX,AX
            case 0x93:    // XCHG AX,BX / XCHG BX,AX
            case 0x94:    // XCHG AX,SP / XCHG SP,AX
            case 0x95:    // XCHG AX,BP / XCHG BP,AX
            case 0x96:    // XCHG AX,SI / XCHG SI,AX
            case 0x97:    // XCHG AX,DI / XCHG DI,AX
            case 0x98:    // CBW (Convert Byte into Word)
            case 0x99:    // CWD (Convert Word to Double-Word)
            case 0x9b:    // WAIT
            case 0x9c:    // PUSHF
            case 0x9d:    // POPF
            case 0x9e:    // SAHF (Store AH into Flags)
            case 0x9f:    // LAHF (Load Flags into AH)
            case 0xa4:    // MOVS mb,mb / MOVSB
            case 0xa5:    // MOVS mw,mw / MOVSW
            case 0xa6:    // CMPSB (Compare String Bytes)
            case 0xa7:    // CMPSW (Compare String Words)
            case 0xaa:    // STOS mb / STOSB (Store String Data)
            case 0xab:    // STOS mw / STOSW (Store String Data)
            case 0xac:    // LODS mb / LODSB (Load String Operand)
            case 0xad:    // LODS mw / LODSW (Load String Operand)
            case 0xae:    // SCAS mb / SCASB (Compare String Data)
            case 0xaf:    // SCAS mw / SCASW (Compare String Data)
            case 0xc3:    // RET
            case 0xc9:    // LEAVE
            case 0xcb:    // RET
            case 0xcc:    // INT 3
            case 0xce:    // INTO
            case 0xcf:    // IRET
            case 0xd7:    // XLAT mb / XLATB
            case 0xec:    // IN AL,DX
            case 0xed:    // IN AX,DX
            case 0xee:    // OUT DX,AL
            case 0xef:    // OUT DX,AX
            case 0xf4:    // HLT (Halt)
            case 0xf5:    // CMC (Complement Carry Flag)
            case 0xf8:    // CLC (Clear Carry Flag)
            case 0xf9:    // STC (Set Carry Flag)
            case 0xfa:    // CLI (Clear Interrupt Flag)
            case 0xfb:    // STI (Set Interrupt Flag)
            case 0xfc:    // CLD (Clear Direction Flag)
            case 0xfd:    // STD (Set Direction Flag)
                break;

            // Byte Argument instructions
            case 0x04:    // ADD AL,db
            case 0x0c:    // OR AL,db
            case 0x0f:    // CLTS (Clear Task Switched Flag) /
            case 0x14:    // ADC AL,db
            case 0x1c:    // SBB AL,db (Integer Subtraction With Borrow)
            case 0x24:    // AND AL,db
            case 0x2c:    // SUB AL,db
            case 0x34:    // XOR AL,db
            case 0x3c:    // CMP AL,db
            case 0x6a:    // PUSH db
            case 0x70:    // JO cb
            case 0x71:    // JNO cb
            case 0x72:    // JB cb / JC cb / JNAE cb
            case 0x73:    // JAE cb / JNB cb / JNC cb
            case 0x74:    // JE cb / JZ cb
            case 0x75:    // JNE cb / JNZ cb
            case 0x76:    // JBE cb / JNA cb
            case 0x77:    // JA cb / JNBE cb
            case 0x78:    // JS cb
            case 0x79:    // JNS cb
            case 0x7a:    // JP cb / JPE cb
            case 0x7b:    // JNP cb / JPO cb
            case 0x7c:    // JL cb / JNGE cb
            case 0x7d:    // JGE cb / JNL cb
            case 0x7e:    // JLE cb / JNG cb
            case 0x7f:    // JG cb / JNLE cb
            case 0xa8:    // TEST AL,db
            case 0xb0:    // MOV AL,db
            case 0xb1:    // MOV CL,db
            case 0xb2:    // MOV DL,db
            case 0xb3:    // MOV BL,db
            case 0xb4:    // MOV AH,db
            case 0xb5:    // MOV CH,db
            case 0xb6:    // MOV DH,db
            case 0xb7:    // MOV BH,db
            case 0xcd:    // INT db
            case 0xd4:    // AAM (ASCII Adjust AX After Multiply)
            case 0xd5:    // AAD (ASCII Adjust AX Before Division)
            case 0xe0:    // LOOPNE cb / LOOPNZ cb
            case 0xe1:    // LOOPE cb / LOOPZ cb
            case 0xe2:    // LOOP cb
            case 0xe3:    // JCXZ cb
            case 0xe4:    // IN AL,db
            case 0xe5:    // IN AX,db
            case 0xe6:    // OUT db,AL
            case 0xe7:    // OUT db,AX
            case 0xeb:    // JMP cb
                // Read byte
                instruction.immediate = this._memory.read8(this.cs, this.ip);
                this.ip++;
                break;

            // Word argument instructions
            case 0x05:    // ADD AX,dw
            case 0x0d:    // OR AX,dw
            case 0x15:    // ADC AX,dw
            case 0x1d:    // SBB AX,dw (Integer Subtraction With Borrow)
            case 0x25:    // AND AX,dw
            case 0x2d:    // SUB AX,dw
            case 0x35:    // XOR AX,dw
            case 0x3d:    // CMP AX,dw
            case 0x68:    // PUSH dw
            case 0xa0:    // MOV AL,xb
            case 0xa1:    // MOV AX,xw
            case 0xa2:    // MOV xb,AL
            case 0xa3:    // MOV xw,AX
            case 0xa9:    // TEST AX,dw
            case 0xb8:    // MOV AX,dw
            case 0xb9:    // MOV CX,dw
            case 0xba:    // MOV DX,dw
            case 0xbb:    // MOV BX,dw
            case 0xbc:    // MOV SP,dw
            case 0xbd:    // MOV BP,dw
            case 0xbe:    // MOV SI,dw
            case 0xbf:    // MOV DI,dw
            case 0xc2:    // RET dw
            case 0xca:    // RET far dw
            case 0xe8:    // CALL cw
            case 0xe9:    // JMP cw
                instruction.immediate = this._memory.readSigned16(this.cs, this.ip);
                this.ip += 2;
                break;

            // Word, Byte argument instructions
            case 0xc8:    // ENTER dw,db
                instruction.immediate = this._memory.read16(this.cs, this.ip);
                this.ip += 2;

                instruction.level = this._memory.read8(this.cs, this.ip);
                this.ip++;
                break;

            // Double-word argument instructions
            case 0x9a:    // CALL far cd
            case 0xea:    // JMP far cd
                instruction.immediate = this._memory.read16(this.cs, this.ip);
                this.ip += 2;

                instruction.targetCS = this._memory.read16(this.cs, this.ip);
                this.ip += 2;
                break;

            // R-Type instructions (/r encoded)

            // R-Type + 16-bit immediate
            case 0x69:    // IMUL rw,ew,dw
            case 0x81:    // ADC ew,dw / ADD ew,dw / AND ew,dw / CMP ew,dw /
                          // OR ew,dw / SBB ew,dw / SUB ew,dw / XOR ew,dw
            case 0xc7:    // MOV ew,dw
            case 0x400:   // Special case for R-Type options of two-byte opcodes
                immediateBytes++;

                // fall-through! (will increment again)

            // R-Type + 8-bit signed immediate
            case 0x6b:    // IMUL rw,db / IMUL rw,ew,db
            case 0x80:    // ADC eb,db / ADD eb,db / AND eb,db / CMP eb,db /
                          // OR eb,db / SBB eb,db / SUB eb,db / XOR eb,db
            case 0x83:    // ADC ew,db / ADD ew,db / CMP ew,db / SBB ew,db /
                          // SUB ew,db
            case 0xc0:    // RCL eb,db / RCR eb,db / ROL eb,db / ROR eb,db /
                          // SAL eb,db / SAR eb,db / SHL eb,db / SHR eb,db
            case 0xc1:    // RCL ew,db / RCR ew,db / ROL ew,db / ROR ew,db /
                          // SAL ew,db / SAR ew,db / SHL ew,db / SHR ew,db
            case 0xc6:    // MOV eb,db
            case 0x200:   // Special case for R-Type options of two-byte opcodes
                immediateBytes++;

                // fall-through!

            // R-Type without immediate (or an /n encoded instruction)
            case 0x00:    // ADD eb,rb
            case 0x01:    // ADD ew,rw
            case 0x02:    // ADD rb,eb
            case 0x03:    // ADD rw,ew
            case 0x08:    // OR eb,rb
            case 0x09:    // OR ew,rw
            case 0x0a:    // OR rb,eb
            case 0x0b:    // OR rw,ew
            case 0x10:    // ADC eb,rb
            case 0x11:    // ADC ew,rw
            case 0x12:    // ADC rb,eb
            case 0x13:    // ADC rw,ew
            case 0x18:    // SBB eb,rb (Integer Subtraction With Borrow)
            case 0x19:    // SBB ew,rw (Integer Subtraction With Borrow)
            case 0x1a:    // SBB rb,eb (Integer Subtraction With Borrow)
            case 0x1b:    // SBB rw,ew (Integer Subtraction With Borrow)
            case 0x20:    // AND eb,rb
            case 0x21:    // AND ew,rw
            case 0x22:    // AND rb,eb
            case 0x23:    // AND rw,ew
            case 0x28:    // SUB eb,rb
            case 0x29:    // SUB ew,rw
            case 0x2a:    // SUB rb,eb
            case 0x2b:    // SUB rw,ew
            case 0x30:    // XOR eb,rb
            case 0x31:    // XOR ew,rw
            case 0x32:    // XOR rb,eb
            case 0x33:    // XOR rw,ew
            case 0x38:    // CMP eb,rb
            case 0x39:    // CMP ew,rw
            case 0x3a:    // CMP rb,eb
            case 0x3b:    // CMP rw,ew
            case 0x62:    // BOUND rw,md
            case 0x63:    // ARPL ew,rw (Adjust RPL Field of Selector)
            case 0x84:    // TEST eb,rb / TEST rb,eb
            case 0x85:    // TEST ew,rw / TEST rw,ew
            case 0x86:    // XCHG eb,rb / XCHG rb,eb
            case 0x87:    // XCHG ew,rw / XCHG rw,ew
            case 0x88:    // MOV eb,rb
            case 0x89:    // MOV ew,rw
            case 0x8a:    // MOV rb,eb
            case 0x8b:    // MOV rw,ew
            case 0x8c:    // MOV ew,ES / MOV ew,CS / MOV ew,SS / MOV ew,DS
            case 0x8d:    // LEA
            case 0x8e:    // MOV ES,mw / MOV ES,rw / MOV SS,mw / MOV SS,rw /
                          // MOV DS,mw / MOV DS,rw
            case 0x8f:    // POP mw
            case 0xc4:    // LES rw,ed
            case 0xc5:    // LDS rw,ed
            case 0xd0:    // RCL eb,1 / RCR eb,1 / ROL eb,1 / ROR eb,1 /
                          // SAL eb,1 / SAR eb,1 / SHL eb,1 / SHR eb,1
            case 0xd1:    // RCL ew,1 / RCR ew,1 / ROL ew,1 / ROR ew,1 /
                          // SAL ew,1 / SAR ew,1 / SHL ew,1 / SHR ew,1
            case 0xd2:    // RCL eb,CL / RCR eb,CL / ROL eb,CL / ROR eb,CL /
                          // SAL eb,CL / SAR eb,CL / SHL eb,CL / SHR eb,CL
            case 0xd3:    // RCL ew,CL / RCR ew,CL / ROL ew,CL / ROR ew,CL /
                          // SAL ew,CL / SAR ew,CL / SHL ew,CL / SHR ew,CL
            case 0xf6:    // DIV eb / IDIV eb / IMUL eb / MUL eb /
                          // NEG eb / NOT eb
            case 0xf7:    // DIV ew / IDIV ew / IMUL ew / MUL ew /
                          // NEG ew / NOT ew
            case 0xfe:    // INC eb
            case 0xff:    // CALL ew / CALL far ed / DEC ew / INC ew /
                          // JMP ew / JMP far ed / PUSH mw
            case 0x100:   // Special case for R-Type options of two-byte opcodes
                // Read the 'ModRM' byte. This contains both a register operand
                // and an effective address operand. Then, it is followed by a
                // possible immediate and displacement field (via Intel docs.)
                let modRM = this._memory.read8(this.cs, this.ip);
                this.ip++;

                // Top two bits are the 'mod' value.
                let mod = (modRM >> 6) & 0x3;

                // Middle three bits are the 'r' value.
                // (This could be an 'n' value depending on the opcode)
                // This picks a register.
                let r = (modRM >> 3) & 0x7;
                instruction.sourceRegister = r;
                instruction.modifier = r;

                // Bottom three bits are the 'r/m' value.
                // This could be a register if (mod == 3)
                // or indicate how the effective address is calculated.
                let rm = modRM & 0x7;

                // The displacement is 0 when the mod is 0 (except when r/m is 6)
                instruction.displacement = 0;

                // Read displacement
                // Displacement is 0 if (mod == 0)
                if (mod == 0 && rm == 6) {
                    // In this particular case, the effective address is given
                    // by the unsigned displacement and not computed.
                    instruction.segment = instruction.segment !== undefined ?
                                          instruction.segment : this.ds;
                    instruction.offset = this._memory.read16(this.cs, this.ip);
                    this.ip += 2;
                }
                else if (mod == 1) {
                    // When mod is 1, the displacement is 1 byte sign-extended.
                    instruction.displacement = this._memory.readSigned8(
                        this.cs, this.ip
                    );
                    this.ip++;
                }
                else if (mod == 2) {
                    // When mod is 2, the displacement is a 16-bit value.
                    instruction.displacement = this._memory.readSigned16(
                        this.cs, this.ip
                    );
                    this.ip += 2;
                }
                else if (mod == 3) {
                    // No displacement. The register is the destination.
                    instruction.operandRegister = rm;
                }

                // Read immediate
                if (immediateBytes == 1) {
                    instruction.immediate = this._memory.readSigned8(this.cs, this.ip);
                    this.ip++;
                }
                else if (immediateBytes == 2) {
                    instruction.immediate = this._memory.readSigned16(this.cs, this.ip);
                    this.ip += 2;
                }

                // Compute the effective address (if needed)
                if ((!instruction.offset) && mod != 3) {
                    switch (rm) {
                        case 0:       // (BX) + (SI) + DISP
                            instruction.segment = instruction.segment !== undefined ?
                                                  instruction.segment : this.ds;
                            instruction.offset = this.bx + this.si
                                               + instruction.displacement;
                            break;
                        case 1:       // (BX) + (DI) + DISP
                            instruction.segment = instruction.segment !== undefined ?
                                                  instruction.segment : this.ds;
                            instruction.offset = this.bx + this.di
                                               + instruction.displacement;
                            break;
                        case 2:       // (BP) + (SI) + DISP
                            instruction.segment = instruction.segment !== undefined ?
                                                  instruction.segment : this.ss;
                            instruction.offset = this.bp + this.si
                                               + instruction.displacement;
                            break;
                        case 3:       // (BP) + (DI) + DISP
                            instruction.segment = instruction.segment !== undefined ?
                                                  instruction.segment : this.ss;
                            instruction.offset = this.bp + this.di
                                               + instruction.displacement;
                            break;
                        case 4:       // (SI) + DISP
                            instruction.segment = instruction.segment !== undefined ?
                                                  instruction.segment : this.ds;
                            instruction.offset = this.si
                                               + instruction.displacement;
                            break;
                        case 5:       // (DI) + DISP
                            instruction.segment = instruction.segment !== undefined ?
                                                  instruction.segment : this.ds;
                            instruction.offset = this.di
                                               + instruction.displacement;
                            break;
                        case 6:       // (BP) + DISP
                            instruction.segment = instruction.segment !== undefined ?
                                                  instruction.segment : this.ss;
                            instruction.offset = this.bp
                                               + instruction.displacement;
                            break;
                        case 7:       // (BX) + DISP
                            instruction.segment = instruction.segment !== undefined ?
                                                  instruction.segment : this.ds;
                            instruction.offset = this.bx
                                               + instruction.displacement;
                            break;
                    }
                }

                // Next instruction has to redetermine if there is an immediate.
                immediateBytes = 0;
                break;

            // Unknown Sinkhole
            default:      // Unimplemented
                //console.log("error: decoded unknown opcode", instruction);
                break;
        }

        return instruction;
    }

    /**
     * Raises the given interrupt.
     */
    raiseInterrupt(index) {
        if (this._interruptHandlers[index]) {
            this._interruptHandlers[index]();
        }
    }

    /**
     * Allow callbacks to be assigned to particular interrupts.
     */
    onInterrupt(index, callback) {
        this._interruptHandlers[index] = callback;
    }

    /**
     * Pushes a 16-bit value to the stack.
     */
    push16(value) {
        this.sp = this.sp - 2;
        this._memory.write16(this.ss, this.sp, value);
    }

    /**
     * Pushes an 8-bit value to the stack.
     */
    push8(value) {
        this.push16(value & 0xff);
    }

    /**
     * Pops a 16-bit value from the stack.
     */
    pop16() {
        let ret = this._memory.read16(this.ss, this.sp);
        this.sp = this.sp + 2;
        return ret;
    }

    /**
     * Pops an 8-bit value from the stack.
     */
    pop8() {
        return this.pop16() & 0xff;
    }

    /**
     * Reads the 8-bit register given by the register index.
     *
     * @param {number} index - The register index.
     *
     * @returns {number} The current register value.
     */
    readRegister8(index) {
        let ret = this._registers[index % 4];
        let low = index < 4;

        if (!low) {
            ret >>= 8;
        }

        return ret & 0xff;
    }

    /**
     * Reads the 16-bit register given by the register index.
     *
     * @param {number} index - The register index.
     *
     * @returns {number} The current register value.
     */
    readRegister16(index) {
        return this._registers[index];
    }

    /**
     * Writes an 8-bit value to the given register.
     *
     * @param {number} index - The register index.
     * @param {number} value - The value to write.
     */
    writeRegister8(index, value) {
        let low = index < 4;

        value &= 0xff;
        if (!low) {
            value <<= 8;
        }
        this._registers[index % 4] = value;
    }

    /**
     * Write a 16-bit value to the given register.
     *
     * @param {number} index - The register index.
     * @param {number} value - The value to write.
     *
     * @returns {number} The current register value.
     */
    writeRegister16(index, value) {
        value &= 0xffff;
        this._registers[index] = value;
    }

    /**
     * Reads the byte operand value given in the instruction.
     *
     * This is referred to as 'eb' in the documentation.
     *
     * @param {Object} instruction - The decoded instruction.
     *
     * @returns {number} The value.
     */
    readOperand8(instruction) {
        if (instruction.operandRegister !== undefined) {
            return this.readRegister8(instruction.operandRegister);
        }

        // Read byte from memory at the effective address
        return this._memory.read8(instruction.segment, instruction.offset);
    }

    /**
     * Reads the 16-bit word operand value given in the instruction.
     *
     * This is referred to as 'ew' in the Intel CPU documentation.
     *
     * @param {Object} instruction - The decoded instruction.
     *
     * @returns {number} The value.
     */
    readOperand16(instruction) {
        if (instruction.operandRegister !== undefined) {
            return this.readRegister16(instruction.operandRegister);
        }

        // Read 16-bit word from memory at the effective address
        return this._memory.read16(instruction.segment, instruction.offset);
    }

    /**
     * Writes the 8-bit byte value to the operand given in the instruction.
     *
     * This is referred to as 'eb' in the Intel CPU documentation.
     *
     * @param {Object} instruction - The decoded instruction.
     * @param {number} value - The value to write.
     */
    writeOperand8(instruction, value) {
        if (instruction.operandRegister !== undefined) {
            return this.writeRegister8(instruction.operandRegister, value);
        }

        // Write byte to memory at the effective address
        return this._memory.write8(
            instruction.segment, instruction.offset,
            value
        );
    }

    /**
     * Writes the 16-bit byte value to the operand given in the instruction.
     *
     * This is referred to as 'ew' in the Intel CPU documentation.
     *
     * @param {Object} instruction - The decoded instruction.
     * @param {number} value - The value to write.
     */
    writeOperand16(instruction, value) {
        if (instruction.operandRegister !== undefined) {
            return this.writeRegister16(instruction.operandRegister, value);
        }

        // Write 16-bit word to memory at the effective address
        return this._memory.write16(
            instruction.segment, instruction.offset,
            value
        );
    }

    /**
     * Executes the instruction.
     */
    execute(instruction) {
        //console.log(this.cs.toString(16) + ":" + this.ip.toString(16));

        // Get the internal opcode
        let opcode = (instruction.opcode || 0xffff) || (instruction.subOpcode || 0);

        // Some placeholder values
        let operation = null;
        let shiftAmount = null;

        // Execute the opcode
        switch(opcode) {
            case 0x00:    // ADD eb,rb
                operation = operation || this.alu.add8.bind(this.alu);
            case 0x08:    // OR eb,rb
                operation = operation || this.alu.or8.bind(this.alu);
            case 0x10:    // ADC eb,rb
                operation = operation || this.alu.adc8.bind(this.alu);
            case 0x18:    // SBB eb,rb (Integer Subtraction With Borrow)
                operation = operation || this.alu.sbb8.bind(this.alu);
            case 0x20:    // AND eb,rb
                operation = operation || this.alu.and8.bind(this.alu);
            case 0x28:    // SUB eb,rb
                operation = operation || this.alu.sub8.bind(this.alu);
            case 0x30:    // XOR eb,rb
                operation = operation || this.alu.xor8.bind(this.alu);

                //console.log([['add', 'adc', 'and', 'xor'],
                //             ['or ', 'sbb', 'sub', 'unk']][(opcode & 0xf) == 0x8 ? 1 : 0][opcode >> 4] + '   eb,rb');

                this.writeOperand8(instruction, operation(
                    this.readOperand8(instruction),
                    this.readRegister8(instruction.sourceRegister)
                ));

                break;

            case 0x01:    // ADD ew,rw
                operation = operation || this.alu.add16.bind(this.alu);
            case 0x09:    // OR ew,rw
                operation = operation || this.alu.or16.bind(this.alu);
            case 0x11:    // ADC ew,rw
                operation = operation || this.alu.adc16.bind(this.alu);
            case 0x19:    // SBB ew,rw (Integer Subtraction With Borrow)
                operation = operation || this.alu.sbb16.bind(this.alu);
            case 0x21:    // AND ew,rw
                operation = operation || this.alu.and16.bind(this.alu);
            case 0x29:    // SUB ew,rw
                operation = operation || this.alu.sub16.bind(this.alu);
            case 0x31:    // XOR ew,rw
                operation = operation || this.alu.xor16.bind(this.alu);

                //console.log([['add', 'adc', 'and', 'xor'],
                //             ['or ', 'sbb', 'sub', 'unk']][(opcode & 0xf) == 0x9 ? 1 : 0][opcode >> 4] + '   ew,rw');

                this.writeOperand16(instruction, operation(
                    this.readOperand16(instruction),
                    this.readRegister16(instruction.sourceRegister)
                ));
                break;

            case 0x02:    // ADD rb,eb
                operation = operation || this.alu.add8.bind(this.alu);
            case 0x0a:    // OR rb,eb
                operation = operation || this.alu.or8.bind(this.alu);
            case 0x12:    // ADC rb,eb
                operation = operation || this.alu.adc8.bind(this.alu);
            case 0x1a:    // SBB rb,eb (Integer Subtraction With Borrow)
                operation = operation || this.alu.sbb8.bind(this.alu);
            case 0x22:    // AND rb,eb
                operation = operation || this.alu.and8.bind(this.alu);
            case 0x2a:    // SUB rb,eb
                operation = operation || this.alu.sub8.bind(this.alu);
            case 0x32:    // XOR rb,eb
                operation = operation || this.alu.xor8.bind(this.alu);

                //console.log([['add', 'adc', 'and', 'xor'],
                //             ['or ', 'sbb', 'sub', 'unk']][(opcode & 0xf) == 0xa ? 1 : 0][opcode >> 4] + '   rb,eb');

                this.writeRegister8(instruction.sourceRegister, operation(
                    this.readRegister8(instruction.sourceRegister),
                    this.readOperand8(instruction)
                ));
                break;

            case 0x03:    // ADD rw,ew
                operation = operation || this.alu.add16.bind(this.alu);
            case 0x0b:    // OR rw,ew
                operation = operation || this.alu.or16.bind(this.alu);
            case 0x13:    // ADC rw,ew
                operation = operation || this.alu.adc16.bind(this.alu);
            case 0x1b:    // SBB rw,ew (Integer Subtraction With Borrow)
                operation = operation || this.alu.sbb16.bind(this.alu);
            case 0x23:    // AND rw,ew
                operation = operation || this.alu.and16.bind(this.alu);
            case 0x2b:    // SUB rw,ew
                operation = operation || this.alu.sub16.bind(this.alu);
            case 0x33:    // XOR rw,ew
                operation = operation || this.alu.xor16.bind(this.alu);

                //console.log([['add', 'adc', 'and', 'xor'],
                //             ['or ', 'sbb', 'sub', 'unk']][(opcode & 0xf) == 0xb ? 1 : 0][opcode >> 4] + '   rw,ew');

                this.writeRegister16(instruction.sourceRegister, operation(
                    this.readRegister16(instruction.sourceRegister),
                    this.readOperand16(instruction)
                ));
                break;

            case 0x04:    // ADD AL,db
                operation = operation || this.alu.add8.bind(this.alu);
            case 0x0c:    // OR AL,db
                operation = operation || this.alu.or8.bind(this.alu);
            case 0x14:    // ADC AL,db
                operation = operation || this.alu.adc8.bind(this.alu);
            case 0x1c:    // SBB AL,db (Integer Subtraction With Borrow)
                operation = operation || this.alu.sbb8.bind(this.alu);
            case 0x24:    // AND AL,db
                operation = operation || this.alu.and8.bind(this.alu);
            case 0x2c:    // SUB AL,db
                operation = operation || this.alu.sub8.bind(this.alu);
            case 0x34:    // XOR AL,db
                operation = operation || this.alu.xor8.bind(this.alu);

                //console.log([['add', 'adc', 'and', 'xor'],
                //             ['or ', 'sbb', 'sub', 'unk']][(opcode & 0xf) == 0xc ? 1 : 0][opcode >> 4] + '   AL,db');

                this.writeRegister8(CPU.REGISTER_AL, operation(
                    this.readRegister8(CPU.REGISTER_AL),
                    instruction.immediate
                ));
                break;

            case 0x05:    // ADD AX,dw
                operation = operation || this.alu.add16.bind(this.alu);
            case 0x0d:    // OR AX,dw
                operation = operation || this.alu.or16.bind(this.alu);
            case 0x15:    // ADC AX,dw
                operation = operation || this.alu.adc16.bind(this.alu);
            case 0x1d:    // SBB AX,dw (Integer Subtraction With Borrow)
                operation = operation || this.alu.sbb16.bind(this.alu);
            case 0x25:    // AND AX,dw
                operation = operation || this.alu.and16.bind(this.alu);
            case 0x2d:    // SUB AX,dw
                operation = operation || this.alu.sub16.bind(this.alu);
            case 0x35:    // XOR AX,dw
                operation = operation || this.alu.xor16.bind(this.alu);

                //console.log([['add', 'adc', 'and', 'xor'],
                //             ['or ', 'sbb', 'sub', 'unk']][(opcode & 0xf) == 0xd ? 1 : 0][opcode >> 4] + '   AX,dw');


                this.writeRegister16(CPU.REGISTER_AX, operation(
                    this.readRegister16(CPU.REGISTER_AX),
                    instruction.immediate
                ));
                break;

            case 0x06:    // PUSH ES
                //console.log('push   es   ');
                this.push16(this.es);
                break;

            case 0x07:    // POP ES
                //console.log('pop    es   ');
                this.es = this.pop16();
                break;

            case 0x0e:    // PUSH CS
                //console.log('push   cs   ');
                this.push16(this.cs);
                break;

            case 0x0f:    // CLTS (Clear Task Switched Flag)
                // Only valid when the immediate is 0x06
                if (instruction.immediate == 0x06) {
                    // TODO: implement CLTS (privileged mode)
                    //console.log('clts        ');
                }
                else {
                    // Invalid opcode
                }

                break;

            case 0x16:    // PUSH SS
                //console.log('push   ss   ');
                this.push16(this.ss);
                break;

            case 0x17:    // POP SS
                //console.log('pop    ss   ');
                this.ss = this.pop16();
                break;

            case 0x1e:    // PUSH DS
                //console.log('push   ds   ');
                this.push16(this.ds);
                break;

            case 0x1f:    // POP DS
                //console.log('pop    ds   ');
                this.ds = this.pop16();
                break;

            //case 0x27:    // DAA (Decimal Adjust AL After Addition)
                // TODO: implement
                break;

            //case 0x2f:    // DAS (Decimal Adjust AL After Subtraction)
                // TODO: implement
                break;

            //case 0x37:    // AAA (ASCII Adjust AL After Addition)
                // TODO: implement
                break;

            case 0x38:    // CMP eb,rb
                operation = operation || this.alu.sub8.bind(this.alu);
            case 0x84:    // TEST eb,rb / TEST rb,eb
                operation = operation || this.alu.and8.bind(this.alu);

                //console.log((opcode == 0x38 ? 'cmp ' : 'test') + '   eb,rb');

                operation(this.readOperand8(instruction),
                          this.readRegister8(instruction.sourceRegister));
                break;

            case 0x39:    // CMP ew,rw
                operation = operation || this.alu.sub16.bind(this.alu);
            case 0x85:    // TEST ew,rw / TEST rw,ew
                operation = operation || this.alu.and16.bind(this.alu);

                //console.log((opcode == 0x39 ? 'cmp ' : 'test') + '   ew,rw');

                operation(this.readOperand16(instruction),
                          this.readRegister16(instruction.sourceRegister));
                break;

            case 0x3a:    // CMP rb,eb
                //console.log('cmp    rb,eb');
                this.alu.sub8(this.readRegister8(instruction.sourceRegister),
                              this.readOperand8(instruction));
                break;

            case 0x3b:    // CMP rw,ew
                //console.log('cmp    rw,ew');
                this.alu.sub16(this.readRegister16(instruction.sourceRegister),
                               this.readOperand16(instruction));

                break;

            case 0x3c:    // CMP AL,db
                operation = operation || this.alu.sub8.bind(this.alu);
            case 0xa8:    // TEST AL,db
                operation = operation || this.alu.and8.bind(this.alu);

                //console.log((opcode == 0x3c ? 'cmp ' : 'test') + '   AL,db');

                operation(this.readRegister8(CPU.REGISTER_AL),
                          instruction.immediate);
                break;

            case 0x3d:    // CMP AX,dw
                operation = operation || this.alu.sub16.bind(this.alu);
            case 0xa9:    // TEST AX,dw
                operation = operation || this.alu.and16.bind(this.alu);

                //console.log((opcode == 0x3d ? 'cmp ' : 'test') + '   AX,dw');

                operation(this.readRegister16(CPU.REGISTER_AX),
                          instruction.immediate);
                break;

            //case 0x3f:    // AAS (ASCII Adjust AL After Subtraction)
                // TODO: implement!
                break;

            case 0x40:    // INC AX
            case 0x41:    // INC CX
            case 0x42:    // INC DX
            case 0x43:    // INC BX
            case 0x44:    // INC SP
            case 0x45:    // INC BP
            case 0x46:    // INC SI
            case 0x47:    // INC DI
                //console.log('inc    +R   ');
                let incDestination = opcode - 0x40;

                this.writeRegister16(incDestination, this.alu.inc16(
                    this.readRegister16(incDestination)));
                break;

            case 0x48:    // DEC AX
            case 0x49:    // DEC CX
            case 0x4a:    // DEC DX
            case 0x4b:    // DEC BX
            case 0x4c:    // DEC SP
            case 0x4d:    // DEC BP
            case 0x4e:    // DEC SI
            case 0x4f:    // DEC DI
                //console.log('dec    +R   ');
                let decDestination = opcode - 0x48;

                this.writeRegister16(decDestination, this.alu.dec16(
                    this.readRegister16(decDestination)));
                break;

            case 0x50:    // PUSH AX
            case 0x51:    // PUSH CX
            case 0x52:    // PUSH DX
            case 0x53:    // PUSH BX
            case 0x54:    // PUSH SP
            case 0x55:    // PUSH BP
            case 0x56:    // PUSH SI
            case 0x57:    // PUSH DI
                //console.log('push   +R   ');
                let pushDestination = opcode - 0x50;

                this.push16(this.readRegister16(pushDestination));
                break;

            case 0x58:    // POP AX
            case 0x59:    // POP CX
            case 0x5a:    // POP DX
            case 0x5b:    // POP BX
            case 0x5c:    // POP SP
            case 0x5d:    // POP BP
            case 0x5e:    // POP SI
            case 0x5f:    // POP DI
                //console.log('pop    +R   ');
                let popDestination = opcode - 0x50;

                this.writeRegister16(popDestination, this.pop16());
                break;

            case 0x60:    // PUSHA
                //console.log('pusha       ');
                let sp = this.sp;
                this.push16(this.ax);
                this.push16(this.cx);
                this.push16(this.dx);
                this.push16(this.bx);
                this.push16(sp);
                this.push16(this.bp);
                this.push16(this.si);
                this.push16(this.di);
                break;

            case 0x61:    // POPA
                //console.log('popa        ');
                this.di = this.pop();
                this.si = this.pop();
                this.bp = this.pop();
                this.pop(); // Discard preserved SP
                this.bx = this.pop();
                this.dx = this.pop();
                this.cx = this.pop();
                this.ax = this.pop();
                break;

            //case 0x62:    // BOUND rw,md
                // TODO: implement
                break;

            //case 0x63:    // ARPL ew,rw (Adjust RPL Field of Selector)
                // TODO: implement
                break;

            case 0x68:    // PUSH dw
                //console.log('push   dw   ');
                this.push16(instruction.immediate);
                break;

            //case 0x69:    // IMUL rw,ew,dw
                // TODO: implement
                break;

            case 0x6a:    // PUSH db
                //console.log('push   db   ');
                this.push16(instruction.immediate);
                break;

            //case 0x6b:    // IMUL rw,db / IMUL rw,ew,db
                // TODO: implement
                break;

            //case 0x6c:    // INS eb,DX / INSB
            //case 0x6d:    // INS ew,DX / INSW
            //case 0x6e:    // OUTS DX,eb / OUTSB
            //case 0x6f:    // OUTS DX,ew / OUTSW
                // TODO: implement
                break;

            case 0x70:    // JO cb
            case 0x71:    // JNO cb
            case 0x72:    // JB cb / JC cb / JNAE cb
            case 0x73:    // JAE cb / JNB cb / JNC cb
            case 0x74:    // JE cb / JZ cb
            case 0x75:    // JNE cb / JNZ cb
            case 0x76:    // JBE cb / JNA cb
            case 0x77:    // JA cb / JNBE cb
            case 0x78:    // JS cb
            case 0x79:    // JNS cb
            case 0x7a:    // JP cb / JPE cb
            case 0x7b:    // JNP cb / JPO cb
            case 0x7c:    // JL cb / JNGE cb
            case 0x7d:    // JGE cb / JNL cb
            case 0x7e:    // JLE cb / JNG cb
            case 0x7f:    // JG cb / JNLE cb
                let jumpCondition = opcode - 0x70;
                let jump = false;

                switch(jumpCondition) {
                    case 0x0:   // OF == 1
                        //console.log('jo     cb   ');
                        jump = this._flags.overflow;
                        break;

                    case 0x1:   // OF == 0
                        //console.log('jno    cb   ');
                        jump = !this._flags.overflow;
                        break;

                    case 0x2:   // CF == 1
                        //console.log('jb     cb   ');
                        jump = this._flags.carry;
                        break;

                    case 0x3:   // CF == 0
                        //console.log('jae    cb   ');
                        jump = !this._flags.carry;
                        break;

                    case 0x4:   // ZF == 1
                        //console.log('je     cb   ');
                        jump = this._flags.zero;
                        break;

                    case 0x5:   // ZF == 0
                        //console.log('jne    cb   ');
                        jump = !this._flags.zero;
                        break;

                    case 0x6:   // CF == 1 || ZF == 1
                        //console.log('jbe    cb   ');
                        jump = this._flags.carry || this._flags.zero;
                        break;

                    case 0x7:   // CF == 0 && ZF == 0
                        //console.log('ja     cb   ');
                        jump = !this._flags.carry && !this._flags.zero;
                        break;

                    case 0x8:   // SF == 1
                        //console.log('js     cb   ');
                        jump = this._flags.signed;
                        break;

                    case 0x9:   // SF == 0
                        //console.log('jns    cb   ');
                        jump = !this._flags.signed;
                        break;

                    case 0xa:   // PF == 1
                        //console.log('jp     cb   ');
                        jump = this._flags.parity;
                        break;

                    case 0xb:   // PF == 0
                        //console.log('jnp    cb   ');
                        jump = !this._flags.parity;
                        break;

                    case 0xc:   // SF != OF
                        //console.log('jl     cb   ');
                        jump = this._flags.signed != this._flags.overflow;
                        break;

                    case 0xd:   // SF == OF
                        //console.log('jge    cb   ');
                        jump = this._flags.signed == this._flags.overflow;
                        break;

                    case 0xe:   // ZF == 1 || SF != OF
                        //console.log('jle    cb   ');
                        jump = this._flags.zero || (this._flags.signed != this._flags.overflow);
                        break;

                    case 0xf:   // ZF == 0 && SF == OF
                        //console.log('jg     cb   ');
                        jump = !this._flags.zero && (this._flags.signed == this._flags.overflow);
                        break;
                }

                if (jump) {
                    // Perform the jump
                    this.ip += instruction.immediate;
                }

                break;

            case 0x80:    // ADC eb,db / ADD eb,db / AND eb,db / CMP eb,db /
                          // OR eb,db / SBB eb,db / SUB eb,db / XOR eb,db
                switch (instruction.modifier) {
                    case 0x0:   // ADD eb,db
                        operation = operation || this.alu.add8.bind(this.alu);
                    case 0x1:   // OR eb,db
                        operation = operation || this.alu.or8.bind(this.alu);
                    case 0x2:   // ADC eb,db
                        operation = operation || this.alu.adc8.bind(this.alu);
                    case 0x3:   // SBB eb,db
                        operation = operation || this.alu.sbb8.bind(this.alu);
                    case 0x4:   // AND eb,db
                        operation = operation || this.alu.and8.bind(this.alu);
                    case 0x5:   // SUB eb,db
                        operation = operation || this.alu.sub8.bind(this.alu);
                    case 0x6:   // XOR eb,db
                        operation = operation || this.alu.xor8.bind(this.alu);

                        //console.log(['add', 'or ', 'adc', 'sbb',
                        //             'and', 'sub', 'xor', 'unk'][instruction.modifier] + '   eb,db');

                        this.writeOperand8(instruction, operation(
                            this.readOperand8(instruction),
                            instruction.immediate
                        ));
                        break;

                    case 0x7:   // CMP eb,db
                        this.alu.sub8(this.readOperand8(instruction),
                                      instruction.immediate);
                        break;
                }

                break;

            case 0x81:    // ADC ew,dw / ADD ew,dw / AND ew,dw / CMP ew,dw /
                          // OR ew,dw / SBB ew,dw / SUB ew,dw / XOR ew,dw
            case 0x83:    // ADC ew,db / ADD ew,db / CMP ew,db / SBB ew,db /
                          // SUB ew,db
                switch (instruction.modifier) {
                    case 0x0:   // ADD ew,dw
                        operation = operation || this.alu.add16.bind(this.alu);
                    case 0x1:   // OR ew,dw
                        operation = operation || this.alu.or16.bind(this.alu);
                    case 0x2:   // ADC ew,dw
                        operation = operation || this.alu.adc16.bind(this.alu);
                    case 0x3:   // SBB ew,dw
                        operation = operation || this.alu.sbb16.bind(this.alu);
                    case 0x4:   // AND ew,dw
                        operation = operation || this.alu.and16.bind(this.alu);
                    case 0x5:   // SUB ew,dw
                        operation = operation || this.alu.sub16.bind(this.alu);
                    case 0x6:   // XOR ew,dw
                        operation = operation || this.alu.xor16.bind(this.alu);

                        //console.log(['add', 'or ', 'adc', 'sbb',
                        //             'and', 'sub', 'xor', 'unk'][instruction.modifier] + '   ew,dw');

                        this.writeOperand16(instruction, operation(
                            this.readOperand16(instruction),
                            instruction.immediate
                        ));
                        break;

                    case 0x7:   // CMP ew,dw
                        this.alu.sub16(this.readOperand16(instruction),
                                       instruction.immediate);
                        break;
                }
                break;

            case 0x86:    // XCHG eb,rb / XCHG rb,eb
                //console.log('xchg   eb,rb');
                let xchgByteTemp = this.readOperand8(instruction);
                this.writeOperand8(
                    instruction,
                    this.readRegister8(
                        instruction.sourceRegister
                    )
                );
                this.writeRegister8(instruction.sourceRegister, xchgByteTemp);
                break;

            case 0x87:    // XCHG ew,rw / XCHG rw,ew
                //console.log('xchg   ew,rw');
                let xchgWordTemp = this.readOperand16(instruction);
                this.writeOperand16(
                    instruction,
                    this.readRegister16(
                        instruction.sourceRegister
                    )
                );
                this.writeRegister16(instruction.sourceRegister, xchgWordTemp);
                break;

            case 0x88:    // MOV eb,rb
                //console.log('mov    eb,rb');
                this.writeOperand8(
                    instruction,
                    this.readRegister8(
                        instruction.sourceRegister
                    )
                );
                break;

            case 0x89:    // MOV ew,rw
                //console.log('mov    ew,rw');
                this.writeOperand16(
                    instruction,
                    this.readRegister16(
                        instruction.sourceRegister
                    )
                );
                break;

            case 0x8a:    // MOV rb,eb
                //console.log('mov    rb,eb');
                this.writeRegister8(instruction.sourceRegister,
                                    this.readOperand8(instruction));
                break;

            case 0x8b:    // MOV rw,ew
                //console.log('mov    rw,ew');
                this.writeRegister16(instruction.sourceRegister,
                                     this.readOperand16(instruction));
                break;

            case 0x8c:    // MOV ew,ES / MOV ew,CS / MOV ew,SS / MOV ew,DS
                //console.log('mov    ew,+S');
                let movSource = instruction.modifier;
                if (movSource >= 4) {
                    // Invalid
                    throw new InvalidInstruction(instruction);
                }

                ////console.log("writing from segment", movSource, this._segmentRegisters[movSource], "to", instruction);
                this.writeOperand16(instruction,
                                    this._segmentRegisters[movSource]);
                break;

            case 0x8d:    // LEA
                //console.log('lea         ');
                this.writeRegister16(instruction.sourceRegister,
                                     instruction.offset);
                break;

            case 0x8e:    // MOV ES,mw / MOV ES,rw / MOV SS,mw / MOV SS,rw /
                          // MOV DS,mw / MOV DS,rw
                //console.log('mov    +S,rm');
                let movDestination = instruction.modifier;
                //console.log(instruction, movDestination, this.readOperand16(instruction));
                if (movDestination >= 4) {
                    // Invalid
                    throw new InvalidInstruction(instruction);
                }
                this._segmentRegisters[movDestination] =
                    this.readOperand16(instruction);
                break;

            case 0x8f:    // POP mw
                //console.log('pop    mw   ');
                if (instruction.modifier != 0) {
                    // Invalid
                    throw new InvalidInstruction(instruction);
                }

                this.writeOperand16(instruction, this.pop16());
                break;

            case 0x90:    // NOP (No Operation) / XCHG AX,AX
            case 0xf0:    // LOCK Prefix
                //console.log('lock        ');
                break;

            case 0x91:    // XCHG AX,CX / XCHG CX,AX
            case 0x92:    // XCHG AX,DX / XCHG DX,AX
            case 0x93:    // XCHG AX,BX / XCHG BX,AX
            case 0x94:    // XCHG AX,SP / XCHG SP,AX
            case 0x95:    // XCHG AX,BP / XCHG BP,AX
            case 0x96:    // XCHG AX,SI / XCHG SI,AX
            case 0x97:    // XCHG AX,DI / XCHG DI,AX
                //console.log('xchg   +R,AX');
                let xchgRegister = opcode - 0x90;
                let temp = this.ax;

                this.ax = this.readRegister16(xchgRegister);
                this.writeRegister16(xchgRegister, temp);
                break;

            case 0x98:    // CBW (Convert Byte into Word)
                //console.log('cbw         ');
                this.ax = this.alu.cbw8(this.al);
                break;

            case 0x99:    // CWD (Convert Word to Double-Word)
                //console.log('cwd         ');
                let cwdValue = this.alu.cwd16(this.ax);
                this.dx = (cwdValue >> 16) & 0xffff;
                this.ax = cwdValue & 0xffff;
                break;

            case 0x9a:    // CALL far cd
                //console.log('callf  cd   ');
                // Push CS
                this.push16(this.cs);

                // Push IP
                this.push16(this.ip);

                // Move to absolute address
                ////console.log('calling from', "0x" + this.cs.toString(16), ":", "0x" + this.ip.toString(16), this.ss, this.sp);
                this.ip = instruction.immediate;
                this.cs = instruction.targetCS;
                ////console.log('calling', "0x" + this.cs.toString(16), ":", "0x" + this.ip.toString(16));
                break;

            case 0x9b:    // WAIT
                //console.log('wait        ');
                // TODO: implement (it is ok if it does nothing)
                break;

            case 0x9c:    // PUSHF
                //console.log('pushf       ');
                this.push16(this.f);
                break;

            case 0x9d:    // POPF
                //console.log('popf        ');
                this.f = this.pop16();
                break;

            case 0x9e:    // SAHF (Store AH into Flags)
                //console.log('sahf        ');
                let sahfValue = this.ax;
                this._flags.carry = (sahfValue & 0x1) != 0;
                this._flags.parity = (sahfValue & 0x4) != 0;
                this._flags.auxiliaryCarry = (sahfValue & 0x10) != 0;
                this._flags.zero = (sahfValue & 0x40) != 0;
                this._flags.signed = (sahfValue & 0x80) != 0;
                break;

            case 0x9f:    // LAHF (Load Flags into AH)
                //console.log('lahf        ');
                let lahfValue = 0;
                lahfValue = this._flags.carry ? (lahfValue | 0x1) : lahfValue;
                lahfValue = this._flags.parity ? (lahfValue | 0x4) : lahfValue;
                lahfValue = this._flags.auxiliaryCarry ? (lahfValue | 0x10) : lahfValue;
                lahfValue = this._flags.zero ? (lahfValue | 0x40) : lahfValue;
                lahfValue = this._flags.signed ? (lahfValue | 0x80) : lahfValue;
                this.ax = lahfValue;
                break;

            case 0xa0:    // MOV AL,xb
                //console.log('mov    AL,xb');
                this.writeRegister8(CPU.REGISTER_AL,
                    this._memory.read8(
                        instruction.segment || this.ds,
                        instruction.immediate
                    )
                );
                break;

            case 0xa1:    // MOV AX,xw
                //console.log('mov    AX,xw');
                this.writeRegister16(
                    CPU.REGISTER_AX,
                    this._memory.read16(
                        instruction.segment || this.ds,
                        instruction.immediate
                    )
                );
                break;

            case 0xa2:    // MOV xb,AL
                //console.log('mov    xb,AL');
                this._memory.write8(
                    instruction.segment || this.ds, instruction.immediate,
                    this.readRegister8(CPU.REGISTER_AL)
                );
                break;

            case 0xa3:    // MOV xw,AX
                //console.log('mov    xw,AX');
                this._memory.write16(
                    instruction.segment || this.ds, instruction.immediate,
                    this.ax
                );
                break;

            case 0xa4:    // MOVS mb,mb / MOVSB
            case 0xa5:    // MOVS mw,mw / MOVSW
                //console.log('movs   mb/mw');
                do {
                    // No segment overrides are allowed.
                    if (instruction.opcode == 0xa4) {
                        this.memory.write8(
                            CPU.REGISTER_ES,
                            this.di,
                            this.memory.read8(
                                instruction.segment || this.ds,
                                this.si
                            )
                        );
                        this.di += this._flags.direction ? -1 : 1;
                        this.si += this._flags.direction ? -1 : 1;
                    }
                    else {
                        this.memory.write16(
                            CPU.REGISTER_ES,
                            this.di,
                            this.memory.read16(
                                instruction.segment || this.ds,
                                this.si
                            )
                        );
                        this.di += this._flags.direction ? -2 : 2;
                        this.si += this._flags.direction ? -2 : 2;
                    }

                    if (instruction.repeat) {
                        this.cx--;
                    }
                    else {
                        break;
                    }
                } while (instruction.repeat && this.cx != 0);
                break;

            case 0xa6:    // CMPSB (Compare String Bytes)
            case 0xa7:    // CMPSW (Compare String Words)
                //console.log('cmps   mb/mw');
                do {
                    // No segment overrides are allowed. (but we allow them??)
                    if (instruction.opcode == 0xa6) {
                        this.alu.sub8(
                            this.memory.read8(
                                instruction.segment || this.ds,
                                this.si
                            ),
                            this.memory.read8(this.es, this.di)
                        );
                        this.di += this._flags.direction ? -1 : 1;
                        this.si += this._flags.direction ? -1 : 1;
                    }
                    else {
                        this.alu.sub16(
                            this.memory.read16(
                                instruction.segment || this.ds,
                                this.si
                            ),
                            this.memory.read16(this.es, this.di)
                        );
                        this.di += this._flags.direction ? -2 : 2;
                        this.si += this._flags.direction ? -2 : 2;
                    }

                    if (instruction.repeat) {
                        this.cx--;

                        if (instruction.repeatNE && this._flags.zero) {
                            break;
                        }
                        else if (instruction.repeatE && !this._flags.zero) {
                            break;
                        }
                    }
                    else {
                        break;
                    }
                } while (instruction.repeat && this.cx != 0);
                break;

            case 0xaa:    // STOS mb / STOSB (Store String Data)
            case 0xab:    // STOS mw / STOSW (Store String Data)
                //console.log('stos   mb/mw');
                do {
                    // No segment overrides are allowed.
                    if (instruction.opcode == 0xaa) {
                        this.memory.write8(this.es, this.di, this.al);
                        this.di += this._flags.direction ? -1 : 1;
                    }
                    else {
                        this.memory.write16(this.es, this.di, this.ax);
                        this.di += this._flags.direction ? -2 : 2;
                    }

                    if (instruction.repeat) {
                        this.cx--;
                    }
                    else {
                        break;
                    }
                } while (instruction.repeat && this.cx != 0);
                break;

            case 0xac:    // LODS mb / LODSB (Load String Operand)
            case 0xad:    // LODS mw / LODSW (Load String Operand)
                //console.log('lods   mb/mw');
                do {
                    if (instruction.opcode == 0xac) {
                        this.al = this.memory.read8(
                            instruction.segment || this.ds,
                            this.si
                        );
                        this.si += this._flags.direction ? -1 : 1;
                    }
                    else {
                        this.ax = this.memory.read16(
                            instruction.segment || this.ds,
                            this.si
                        );
                        this.si += this._flags.direction ? -2 : 2;
                    }

                    if (instruction.repeat) {
                        this.cx--;
                    }
                } while (instruction.repeat && this.cx != 0);
                break;

            case 0xae:    // SCAS mb / SCASB (Compare String Data)
            case 0xaf:    // SCAS mw / SCASW (Compare String Data)
                //console.log('scas   mb/mw');
                do {
                    // No segment overrides are allowed.
                    if (instruction.opcode == 0xae) {
                        this.alu.sub8(this.al, this.memory.read8(this.es, this.di));
                        this.di += this._flags.direction ? -1 : 1;
                    }
                    else {
                        this.alu.sub16(this.ax, this.memory.read16(this.es, this.di));
                        this.di += this._flags.direction ? -2 : 2;
                    }

                    if (instruction.repeat) {
                        this.cx--;

                        if (instruction.repeatNE && this._flags.zero) {
                            break;
                        }
                        else if (instruction.repeatE && !this._flags.zero) {
                            break;
                        }
                    }
                    else {
                        break;
                    }
                } while (instruction.repeat && this.cx != 0);
                break;

            case 0xb0:    // MOV AL,db
            case 0xb1:    // MOV CL,db
            case 0xb2:    // MOV DL,db
            case 0xb3:    // MOV BL,db
            case 0xb4:    // MOV AH,db
            case 0xb5:    // MOV CH,db
            case 0xb6:    // MOV DH,db
            case 0xb7:    // MOV BH,db
                //console.log('mov    +r,db');
                let movByteDestination = opcode - 0xb0;
                this.writeRegister8(movByteDestination, instruction.immediate);
                break;

            case 0xb8:    // MOV AX,dw
            case 0xb9:    // MOV CX,dw
            case 0xba:    // MOV DX,dw
            case 0xbb:    // MOV BX,dw
            case 0xbc:    // MOV SP,dw
            case 0xbd:    // MOV BP,dw
            case 0xbe:    // MOV SI,dw
            case 0xbf:    // MOV DI,dw
                //console.log('mov    +R,dw');
                let movWordDestination = opcode - 0xb8;
                this.writeRegister16(movWordDestination, instruction.immediate);
                break;

            case 0xc0:    // RCL eb,db / RCR eb,db / ROL eb,db / ROR eb,db /
                          // SAL eb,db / SAR eb,db / SHL eb,db / SHR eb,db
                shiftAmount = shiftAmount == null ? instruction.immediate : shiftAmount;
            case 0xd0:    // RCL eb,1 / RCR eb,1 / ROL eb,1 / ROR eb,1 /
                          // SAL eb,1 / SAR eb,1 / SHL eb,1 / SHR eb,1
                shiftAmount = shiftAmount == null ? 1 : shiftAmount;
            case 0xd2:    // RCL eb,CL / RCR eb,CL / ROL eb,CL / ROR eb,CL /
                          // SAL eb,CL / SAR eb,CL / SHL eb,CL / SHR eb,CL
                shiftAmount = shiftAmount == null ?
                    this.readRegister8(CPU.REGISTER_CL) : shiftAmount;

                //console.log('shift  eb/..');

                switch (instruction.modifier) {
                    case 0x0:   // ROL eb,db (Rotate 8-bit Eb left)
                        operation = operation || this.alu.rol8.bind(this.alu);
                    case 0x1:   // ROR eb,db (Rotate 8-bit Eb right)
                        operation = operation || this.alu.ror8.bind(this.alu);
                    case 0x2:   // RCL eb,db (Rotate 9-bits (CF,Eb) left)
                        operation = operation || this.alu.rcl8.bind(this.alu);
                    case 0x3:   // RCR eb,db (Rotate 9-bits (CF,Eb) right)
                        operation = operation || this.alu.rcr8.bind(this.alu);
                    case 0x4:   // SAL eb,db / SHL eb,db
                        operation = operation || this.alu.shl8.bind(this.alu);
                    case 0x5:   // SHR eb,db
                        operation = operation || this.alu.shr8.bind(this.alu);
                    case 0x7:   // SAR eb,db
                        operation = operation || this.alu.sar8.bind(this.alu);
                        break;
                    default:
                        // Invalid
                        throw new InvalidInstruction(instruction);
                }

                this.writeOperand8(instruction, operation(
                    this.readOperand8(instruction),
                    shiftAmount
                ));
                break;

            case 0xc1:    // RCL ew,db / RCR ew,db / ROL ew,db / ROR ew,db /
                          // SAL ew,db / SAR ew,db / SHL ew,db / SHR ew,db
                shiftAmount = shiftAmount == null ? instruction.immediate : shiftAmount;
            case 0xd1:    // RCL ew,1 / RCR ew,1 / ROL ew,1 / ROR ew,1 /
                          // SAL ew,1 / SAR ew,1 / SHL ew,1 / SHR ew,1
                shiftAmount = shiftAmount == null ? 1 : shiftAmount;
            case 0xd3:    // RCL ew,CL / RCR ew,CL / ROL ew,CL / ROR ew,CL /
                          // SAL ew,CL / SAR ew,CL / SHL ew,CL / SHR ew,CL
                shiftAmount = shiftAmount == null ?
                    this.readRegister8(CPU.REGISTER_CL) : shiftAmount;
                //console.log('shift  ew/..');

                switch (instruction.modifier) {
                    case 0x0:   // ROL ew,shamt (Rotate 16-bit Ew left)
                        operation = operation || this.alu.rol16.bind(this.alu);
                    case 0x1:   // ROR ew,shamt (Rotate 16-bit Ew right)
                        operation = operation || this.alu.ror16.bind(this.alu);
                    case 0x2:   // RCL ew,shamt (Rotate 17-bits (CF,Ew) left)
                        operation = operation || this.alu.rcl16.bind(this.alu);
                    case 0x3:   // RCR ew,shamt (Rotate 17-bits (CF,Ew) right)
                        operation = operation || this.alu.rcr16.bind(this.alu);
                    case 0x4:   // SAL ew,shamt / SHL ew,shamt
                        operation = operation || this.alu.shl16.bind(this.alu);
                    case 0x5:   // SHR ew,shamt
                        operation = operation || this.alu.shr16.bind(this.alu);
                    case 0x7:   // SAR ew,shamt
                        operation = operation || this.alu.sar16.bind(this.alu);
                        break;
                    default:
                        // Invalid
                        throw new InvalidInstruction(instruction);
                }

                this.writeOperand16(instruction, operation(
                    this.readOperand16(instruction),
                    shiftAmount
                ));
                break;

            case 0xc2:    // RET dw
                //console.log('ret    dw   ');
                this.ip = this.pop16();
                this.sp = this.sp + instruction.immediate;
                break;

            case 0xc3:    // RET
                //console.log('ret         ');
                this.ip = this.pop16();
                break;

            case 0xc4:    // LES rw,ed (Load EA dword into DS/rw)
            case 0xc5:    // LDS rw,ed (Load EA dword into DS/rw)
                //console.log('le/ds  rw,eb');
                if (!instruction.segment) {
                    throw new InvalidInstruction(instruction);
                }

                this.writeRegister16(instruction.sourceRegister,
                                     this.readOperand16(instruction));

                if (opcode == 0xc4) {
                    this.es = this._memory.read16(instruction.segment,
                                                  instruction.offset + 2);
                }
                else {
                    this.ds = this._memory.read16(instruction.segment,
                                                  instruction.offset + 2);
                }
                break;

            case 0xc6:    // MOV eb,db
                //console.log('mov    eb,db');
                this.writeOperand8(instruction, instruction.immediate);
                break;

            case 0xc7:    // MOV ew,dw
                //console.log('mov    ew,dw');
                this.writeOperand16(instruction, instruction.immediate);
                break;

            case 0xc8:    // ENTER dw,db
                //console.log('enter  dw,db');
                // Push BP
                this.push16(this.bp);

                if (instruction.level == 0) {
                    // Set BP to SP
                    this.bp = this.sp;
                }
                else {
                    // Retain original SP
                    let enterSP = this.sp;

                    // For each level...
                    this.instruction.level--;
                    while(instruction.level > 0) {
                        // Subtract two from BP to go to next item
                        this.bp = this.bp - 2;

                        // Push the word at that address
                        this.push16(this._memory.read16(this.ss, this.bp));

                        // Decrease our nesting level
                        instruction.level--;
                    }

                    // Push SP
                    this.push16(enterSP);

                    // Set BP to SP
                    this.bp = enterSP;
                }
                break;

            case 0xc9:    // LEAVE
                //console.log('leave       ');
                this.sp = this.bp;
                this.bp = this.pop16();
                break;

            case 0xca:    // RET far dw
                //console.log('retf   dw   ');
                this.ip = this.pop16();
                this.cs = this.pop16();
                this.sp = this.sp + instruction.immediate;
                break;

            case 0xcb:    // RET
                //console.log('ret         ');
                this.ip = this.pop16();
                this.cs = this.pop16();
                break;

            case 0xcc:    // INT 3
                //console.log('int 3       ');
                this.raiseInterrupt(3);
                break;

            case 0xcd:    // INT db
                //console.log('int         ');
                this.raiseInterrupt(instruction.immediate);
                break;

            case 0xce:    // INTO
                //console.log('into        ');
                if (this._flags.overflow) {
                    this.raiseInterrupt(4);
                }
                break;

            case 0xcf:    // IRET
                //console.log('iret        ');
                this.ip = this.pop16();
                this.cs = this.pop16();
                this.f = this.pop16();
                break;

            //case 0xd4:    // AAM (ASCII Adjust AX After Multiply)
                // TODO: implement
                break;

            //case 0xd5:    // AAD (ASCII Adjust AX Before Division)
                // TODO: implement
                break;

            case 0xd7:    // XLAT mb / XLATB
                //console.log('xlat   mb');
                this.al = this.memory.read8(
                    instruction.segment || this.ds,
                    (this.bx + this.al) & 0xffff
                );
                break;

            //case 0xe0:    // LOOPNE cb / LOOPNZ cb
            //case 0xe1:    // LOOPE cb / LOOPZ cb
            //case 0xe2:    // LOOP cb
                // TODO: implement
                break;

            case 0xe3:    // JCXZ cb
                //console.log('jcxz   cb   cx=', this.cx);
                if (this.cx == 0) {
                    this.ip += instruction.immediate;
                }
                break;

            //case 0xe4:    // IN AL,db
            //case 0xe5:    // IN AX,db
            //case 0xec:    // IN AL,DX
            //case 0xed:    // IN AX,DX
                // TODO: implement
                //this.fromPort(port, value);
                break;

            //case 0xe6:    // OUT db,AL
            //case 0xe7:    // OUT db,AX
            //case 0xee:    // OUT DX,AL
            //case 0xef:    // OUT DX,AX
                // TODO: implement
                //this.toPort(port, value);
                break;

            case 0xe8:    // CALL cw
                //console.log('call   cw   ');
                // Push IP
                this.push16(this.ip);

                this.ip += instruction.immediate;
                break;

            case 0xe9:    // JMP cw
            case 0xeb:    // JMP cb
                //console.log('jmp    cw/cb');
                this.ip += instruction.immediate;
                break;

            case 0xea:    // JMP far cd
                //console.log('jmpf   cd   ');
                this.ip = instruction.immediate;
                this.cs = instruction.targetCS;
                break;

            case 0xf2:    // REPNE Prefix
            case 0xf3:    // REP / REPE Prefix
                //console.log('rep[ne]     ');
                break;

            case 0xf4:    // HLT (Halt)
                // TODO: halt machine
                //console.log('hlt         ');
                break;

            case 0xf5:    // CMC (Complement Carry Flag)
                //console.log('cmc         ');
                this._flags.carry = !this._flags.carry;
                break;

            case 0xf6:    // DIV eb / IDIV eb / IMUL eb / MUL eb /
                          // NEG eb / NOT eb
                switch (instruction.modifier) {
                    case 0x0:   // TEST (not possible)
                    case 0x1:   // Also not implemented
                        throw new InvalidInstruction(instruction);
                    case 0x2:   // NOT eb
                        //console.log('not    eb   ');
                        this.writeOperand8(instruction,
                            this.alu.not8(this.readOperand8(instruction)));
                        break;
                    case 0x3:   // NEG eb
                        //console.log('neg    eb   ');
                        this.writeOperand8(instruction,
                            this.alu.neg8(this.readOperand8(instruction)));
                        break;
                    case 0x4:   // MUL eb
                        //console.log('mul    eb   ');
                        this.ax = this.alu.mul8(this.al,
                                                this.readOperand8(instruction));
                        break;
                    case 0x5:   // IMUL eb
                        //console.log('imul   eb   ');
                        this.ax = this.alu.imul8(this.al,
                                                 this.readOperand8(instruction));
                        break;
                    case 0x6:   // DIV eb
                        //console.log('div    eb   ');
                        this.ax = this.alu.div8(this.al,
                                                this.readOperand8(instruction));
                        break;
                    case 0x7:   // IDIV eb
                        //console.log('idev   eb   ');
                        this.ax = this.alu.idiv8(this.al,
                                                 this.readOperand8(instruction));
                        break;
                }
                break;

            case 0xf7:    // DIV ew / IDIV ew / IMUL ew / MUL ew /
                          // NEG ew / NOT ew
                let aluWordOperand = this.readOperand16(instruction);
                switch (instruction.modifier) {
                    case 0x0:   // TEST (not possible)
                    case 0x1:   // Also not implemented
                        throw new InvalidInstruction(instruction);
                    case 0x2:   // NOT ew
                        //console.log('not    ew   ');
                        this.writeOperand16(instruction,
                            this.alu.not16(aluWordOperand));
                        break;
                    case 0x3:   // NEG ew
                        //console.log('neg    ew   ');
                        this.writeOperand16(instruction,
                            this.alu.neg16(aluWordOperand));
                        break;
                    case 0x4:   // MUL ew
                        //console.log('mul    ew   ');
                        let mulResult = this.alu.mul16(this.ax, aluWordOperand);
                        this.dx = (mulResult >> 16) & 0xffff;
                        this.ax = mulResult & 0xffff;
                        break;
                    case 0x5:   // IMUL ew
                        //console.log('imul   ew   ');
                        let imulResult = this.alu.imul16(this.ax, aluWordOperand);
                        this.dx = (imulResult >> 16) & 0xffff;
                        this.ax = imulResult & 0xffff;
                        break;
                    case 0x6:   // DIV ew
                        //console.log('div    ew   ');
                        let divResult = this.alu.div16(this.ax, aluWordOperand);
                        this.dx = (divResult >> 16) & 0xffff;
                        this.ax = divResult & 0xffff;
                        break;
                    case 0x7:   // IDIV ew
                        //console.log('idiv   ew   ');
                        let idivResult = this.alu.idiv16(this.ax, aluWordOperand);
                        this.dx = (idivResult >> 16) & 0xffff;
                        this.ax = idivResult & 0xffff;
                        break;
                }
                break;

            case 0x2f6:    // TEST eb,db
                //console.log('test   eb,db');
                this.alu.and8(this.readOperand8(instruction),
                              instruction.immediate);
                break;

            case 0x4f7:    // TEST ew,dw
                //console.log('test   ew,dw');
                this.alu.and16(this.readOperand16(instruction),
                               instruction.immediate);
                break;

            case 0xf8:    // CLC (Clear Carry Flag)
                //console.log('clc      ');
                this._flags.carry = false;
                break;

            case 0xf9:    // STC (Set Carry Flag)
                //console.log('stc      ');
                this._flags.carry = true;
                break;

            case 0xfa:    // CLI (Clear Interrupt Flag)
                //console.log('cli      ');
                this._flags.interruptEnable = false;
                break;

            case 0xfb:    // STI (Set Interrupt Flag)
                //console.log('sti      ');
                this._flags.interruptEnable = true;
                break;

            case 0xfc:    // CLD (Clear Direction Flag)
                //console.log('cld      ');
                this._flags.direction = false;
                break;

            case 0xfd:    // STD (Set Direction Flag)
                //console.log('std      ');
                this._flags.direction = true;
                break;

            case 0xfe:    // INC eb
                //console.log('inc    eb');
                this.writeOperand8(
                    instruction,
                    this.alu.inc8(this.readOperand8(instruction))
                );
                break;

            case 0xff:    // CALL ew / CALL far ed / DEC ew / INC ew /
                          // JMP ew / JMP far ed / PUSH mw
                switch (instruction.modifier) {
                    case 0x0:   // INC ew
                        //console.log('inc    ew');
                        operation = operation | this.alu.inc16.bind(this.alu);
                    case 0x1:   // DEC ew
                        //console.log('dec    ew');
                        operation = operation | this.alu.dec16.bind(this.alu);

                        this.writeOperand16(
                            instruction,
                            operation(this.readOperand16(instruction))
                        );
                        break;

                    case 0x2:   // CALL ew
                        //console.log('call   ew');
                        // Push IP
                        this.push16(this.ip);

                        // Set IP to the given operand
                        this.ip = this.readOperand16(instruction);
                        break;

                    case 0x3:   // CALL far ed
                        //console.log('callf  ed');
                        if (!instruction.segment) {
                            throw new InvalidInstruction(instruction);
                        }

                        // Push CS
                        this.push16(this.cs);

                        // Push IP
                        this.push16(this.ip);

                        // Set IP to the given operand
                        this.ip = this.readOperand16(instruction);

                        // Set CS to the following word
                        this.cs = this._memory.read16(instruction.segment,
                                                      instruction.offset + 2);
                        break;

                    case 0x4:   // JMP ew
                        //console.log('jmp    ew');
                        this.ip = this.readOperand16(instruction);
                        break;

                    case 0x5:   // JMP far ed
                        //console.log('jmpf   ed');
                        //console.log(instruction);
                        //console.log(this.memory);
                        if (!instruction.segment) {
                            throw new InvalidInstruction(instruction);
                        }

                        // Set IP to the given operand
                        this.ip = this.readOperand16(instruction);

                        // Set CS to the following word
                        this.cs = this._memory.read16(instruction.segment,
                                                      instruction.offset + 2);
                        break;

                    case 0x6:   // PUSH mw
                        //console.log('push   mw');
                        this.push16(this.readOperand16(instruction));
                        break;

                    case 0x7:   // Invalid
                        throw new InvalidInstruction(instruction);
                        break;
                }
                break;

            default:
                // Unknown
                //console.log("error: executing unknown opcode", instruction);
                throw new InvalidInstruction(instruction);
        }
    }
}

// Register index values for general 16-bit registers.
CPU.REGISTER_AX = 0;
CPU.REGISTER_CX = 1;
CPU.REGISTER_DX = 2;
CPU.REGISTER_BX = 3;
CPU.REGISTER_SP = 4;
CPU.REGISTER_BP = 5;
CPU.REGISTER_SI = 6;
CPU.REGISTER_DI = 7;

// Register index values for general 8-bit registers.
CPU.REGISTER_AL = 0;
CPU.REGISTER_CL = 1;
CPU.REGISTER_DL = 2;
CPU.REGISTER_BL = 3;
CPU.REGISTER_AH = 4;
CPU.REGISTER_CH = 5;
CPU.REGISTER_DH = 6;
CPU.REGISTER_BH = 7;

// Register index values for 16-bit segment registers.
CPU.REGISTER_ES = 0;
CPU.REGISTER_CS = 1;
CPU.REGISTER_SS = 2;
CPU.REGISTER_DS = 3;

// Register names respective to the index values above
CPU.REGISTERS_G16 = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
CPU.REGISTERS_G8 = ['al', 'cl', 'dl', 'bl', 'ah', 'ch', 'dh', 'bh'];
CPU.REGISTERS_S = ['es', 'cs', 'ss', 'ds'];

export class InvalidInstruction {
    constructor(instruction) {
        this._instruction = instruction;
    }
}

export default CPU;
