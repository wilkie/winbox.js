export function setDescriptor(this: any, selector, address) {
  const core = this._machine.cpu.core;
  const memory = this._machine.memory;
  const entry = core.ldtBase + (selector >> 3) * 8;

  for (let k = 0; k < 8; k++) {
    memory.write8(entry + k, memory.read8(address + k));
  }

  // Forgotten under each privilege level its selector can be loaded at.
  if (core._translationCache) {
    for (let rpl = 0; rpl < 8; rpl++) {
      core._translationCache[(selector & ~7) | rpl] = undefined;
    }
  }
  core.flags.carry = false;
}
