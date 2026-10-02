export function setDescriptor(this: any, selector, address) {
  const core = this._machine.cpu.core;
  const memory = this._machine.memory;
  const entry = core.ldtBase + (selector >> 3) * 8;

  for (let k = 0; k < 8; k++) {
    memory.write8(entry + k, memory.read8(address + k));
  }

  if (core._translationCache) {
    core._translationCache[selector] = undefined;
  }
  core.flags.carry = false;
}
