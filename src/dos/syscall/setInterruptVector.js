export function setInterruptVector(index, vectorSegment, vectorOffset) {
    let idtSegment = this.machine.idtSegment;

    this._machine.cpu.core.write16(idtSegment, index * 4, vectorOffset);
    this._machine.cpu.core.write16(idtSegment, (index * 4) + 2, vectorSegment);
}
