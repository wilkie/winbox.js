export function getInterruptVector(index) {
    let idtSegment = this.machine.idtSegment;

    let bx = this.machine.cpu.core.read16(idtSegment, index * 4);
    let es = this.machine.cpu.core.read16(idtSegment, (index * 4) + 2);

    return [es, bx]
}
