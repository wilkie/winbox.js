'use strict';

import { ArgumentKind, argumentPlan } from './argument-plan.js';
import { readableString } from './kernel/bad-pointers.js';

/**
 * A call's arguments read off the stack at SS:SP, under its far return
 * address, as its function's plan reads them (`argument-plan.ts`): words,
 * longs, structures read in, and strings read -- a null one as null, one of
 * segment nought as its number. `rejected` where a string cannot be read:
 * the API's check of its arguments turns the call away, answering nought,
 * as USER and GDI do (**recorded** by `badarg`). Not all of Windows checks:
 * RegisterWindowMessage faults instead, which is not followed.
 */
export function readArguments(system: any, definition: any[], ss: number, sp: number) {
  const plan = argumentPlan(definition);
  const core = system.machine.cpu.core;
  const memory = system.machine.memory;
  let offset = 4; // Account for CS:IP on stack

  let rejected = false;
  const args: any[] = new Array(plan.steps.length);

  for (let index = 0; index < plan.steps.length; index++) {
    const step = plan.steps[index];

    switch (step.kind) {
      case ArgumentKind.Word: {
        const value = step.signed
          ? core.readSigned16(ss, sp + offset)
          : core.read16(ss, sp + offset);

        offset += 2;
        args[index] = step.byte ? value & 0xff : value;
        break;
      }

      case ArgumentKind.Dword:
      case ArgumentKind.Struct:
      case ArgumentKind.String: {
        const lo = core.read16(ss, sp + offset);
        const hi = core.read16(ss, sp + offset + 2);

        offset += 4;

        if (step.kind == ArgumentKind.Struct) {
          if (hi == 0 && lo == 0) {
            // null pointer
            args[index] = null;
          } else {
            // Read in the struct data
            const struct = new step.struct();
            struct.loadFromMemory(memory, hi >> 3, lo);
            args[index] = struct;
          }
        } else if (step.kind == ArgumentKind.String) {
          // Read string at [ret-hi]:[ret-lo]
          if (hi == 0 && lo == 0) {
            // null string
            args[index] = null;
          } else if (hi == 0) {
            // null segment falls back to a number instead
            args[index] = lo;
          } else if (!readableString(core, hi, lo)) {
            rejected = true;
            args[index] = null;
          } else {
            const ret: any = new String(memory.readCString(core.translateAddress(hi, lo)));
            ret.segment = hi;
            ret.offset = lo;
            args[index] = ret;
          }
        } else {
          args[index] = (hi << 16) | (lo & 0xffff);
        }
        break;
      }

      // VARIADIC, and a type of no size read here, read nothing.
    }
  }

  if (plan.variadic) {
    // Add a pointer to the stack
    args[args.length - 1] = (ss << 16) | (sp + offset);
  } else {
    args.reverse();
  }

  return { args, rejected };
}
