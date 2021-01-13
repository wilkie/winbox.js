export function Throw(lpbuf, ret) {
    // The structure of the CATCHBUF:
    // 0: ip
    // 1: cs
    // 2: sp - (4 * 2) (account for the stuff already there)
    // 3: bp
    // 4: si
    // 5: di
    // 6: ds
    // 7: 0
    // 8: ss

    // Copy the data to memory
    let destSegment = (lpbuf >> 16) & 0xffff;
    let destOffset = lpbuf & 0xffff;

    let address = this.machine.cpu.core.translateAddress(destSegment, destOffset);

    // Read the CATCHBUF data
    // Notice that sp adds '6' to counter the 8 subtracted in Catch
    // This is because we have another argument to account for.
    let callerIP = this.machine.memory.read16(address + 0);
    let callerCS = this.machine.memory.read16(address + 1);
    this.machine.cpu.sp = this.machine.memory.read16(address + 2) + 6;
    this.machine.cpu.bp = this.machine.memory.read16(address + 3);
    this.machine.cpu.si = this.machine.memory.read16(address + 4);
    this.machine.cpu.di = this.machine.memory.read16(address + 5);
    this.machine.cpu.ds = this.machine.memory.read16(address + 6);
    // Ignoring empty 7th index
    this.machine.cpu.ss = this.machine.memory.read16(address + 8);

    // Set the IP/CS to align with the Catch call
    // We will return to just after the Catch call instead of after Throw.
    this._machine.cpu.core.write16(
        this._machine.cpu.core.ss,
        this._machine.cpu.core.sp,
        callerIP
    );

    this._machine.cpu.core.write16(
        this._machine.cpu.core.ss,
        this._machine.cpu.core.sp + 2,
        callerCS
    );

    // Set the other two Throw arguments back up
    this._machine.cpu.core.write32(
        this._machine.cpu.core.ss,
        this._machine.cpu.core.sp + 4,
        lpbuf
    );

    this._machine.cpu.core.write16(
        this._machine.cpu.core.ss,
        this._machine.cpu.core.sp + 8,
        ret
    );

    // We actually are returning to a different area, but we return the
    // value indicated in the arguments.
    return ret;
}
