export function getInterruptVector(index) {
    const idtSegment = this.machine.idtSegment;

    const bx = this.machine.cpu.core.read16(idtSegment, index * 4);
    const es = this.machine.cpu.core.read16(idtSegment, (index * 4) + 2);

    return [es, bx]
}
