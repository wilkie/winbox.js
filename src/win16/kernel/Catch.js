export function Catch(lpbuf) {
    // The structure of the CATCHBUF:
    // 0: ip
    // 1: cs
    // 2: sp - (2 * 4) (account for apparently pushed words)
    // 3: bp
    // 4: si
    // 5: di
    // 6: ds
    // 7: 0
    // 8: ss

    // The stuff already on the stack:
    // [ callerIP ] +0
    // [ callerCS ] +2
    // [ lpbuf LO ] +4
    // [ lpbuf HI ] +6
    //
    // When Throw returns from Catch, the stack needs to be:
    //
    // [ callerIP ] +0
    // [ callerCS ] +2
    // [ lpbuf LO ] +4
    // [ lpbuf HI ] +6
    // [ nErrorRt ] +8

    // Get the IP/CS for the Catch call
    let callerIP = this._machine.cpu.core.read16(
        this._machine.cpu.core.ss,
        this._machine.cpu.core.sp
    );

    let callerCS = this._machine.cpu.core.read16(
        this._machine.cpu.core.ss,
        this._machine.cpu.core.sp + 2
    );

    // Copy the data to memory
    let destSegment = (lpbuf >> 16) & 0xffff;
    let destOffset = lpbuf & 0xffff;

    let address = this.machine.cpu.core.translateAddress(destSegment, destOffset);

    // Write the CATCHBUF data
    this.machine.memory.write16(address + 0, callerIP);
    this.machine.memory.write16(address + 1, callerCS);
    this.machine.memory.write16(address + 2, this.machine.cpu.sp - 8);
    this.machine.memory.write16(address + 3, this.machine.cpu.bp);
    this.machine.memory.write16(address + 4, this.machine.cpu.si);
    this.machine.memory.write16(address + 5, this.machine.cpu.di);
    this.machine.memory.write16(address + 6, this.machine.cpu.ds);
    this.machine.memory.write16(address + 7, 0);
    this.machine.memory.write16(address + 8, this.machine.cpu.ss);

    // Catch returns 0 to reflect it is not a return from Throw()
    return 0;
}
