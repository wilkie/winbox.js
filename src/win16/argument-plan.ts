'use strict';

import { Types, Struct, VARIADIC } from './types.js';

/**
 * How a call's arguments are read off the stack, worked out once for each
 * function an API module exports: every call a program makes is read
 * through one, and a program that polls makes hundreds of thousands. What
 * `syscallInvoke` reads is what it read when it asked each argument's type
 * on every call; only the asking is done once.
 */

/** What an argument is, as read. */
export const ArgumentKind = {
  /** The `VARIADIC` marker: nothing read, the stack's address given after. */
  Variadic: 0,
  /** A word, or a byte in one, signed or not. */
  Word: 1,
  /** Two words, a number. */
  Dword: 2,
  /** A far pointer to a structure, read into one. */
  Struct: 3,
  /** A far pointer to a string, or a resource's number. */
  String: 4,
  /** A type of no size the call reads: nothing, and nothing taken. */
  None: 5,
} as const;

export type ArgumentStep = {
  kind: number;
  /** For a word: whether read signed, and whether only its low byte kept. */
  signed: boolean;
  byte: boolean;
  /** For a structure: its class. */
  struct: any;
};

export type ArgumentPlan = {
  /** The steps, in the order the arguments lie on the stack, up from CS:IP. */
  steps: ArgumentStep[];
  /** Whether the list ends in `VARIADIC`: kept in order, not reversed. */
  variadic: boolean;
};

const PLANS = new WeakMap<any[], ArgumentPlan>();

/** The plan for a function's definition, as an API module's table gives it. */
export function argumentPlan(definition: any[]): ArgumentPlan {
  let plan = PLANS.get(definition);

  if (!plan) {
    plan = planFor(definition[3] || []);
    PLANS.set(definition, plan);
  }

  return plan;
}

function planFor(declared: any[]): ArgumentPlan {
  const variadic = declared[declared.length - 1] == VARIADIC;

  /* Pascal's calling convention pushes the first argument first, so the
   * last lies nearest the return address. */
  const inStackOrder = variadic ? declared : [...declared].reverse();

  return { variadic, steps: inStackOrder.map(stepFor) };
}

function stepFor(type: any): ArgumentStep {
  const step: ArgumentStep = { kind: ArgumentKind.None, signed: false, byte: false, struct: null };

  if (type == VARIADIC) {
    step.kind = ArgumentKind.Variadic;
    return step;
  }

  const size = Types.sizeof(type);

  if (size <= 2) {
    step.kind = ArgumentKind.Word;
    step.signed = !!Types.signed(type);
    step.byte = size == 1;
  } else if (size == 4) {
    // An array type is a pointer to its element type.
    const pointee = type instanceof Array ? type[0] : type;

    if (pointee.prototype instanceof Struct) {
      step.kind = ArgumentKind.Struct;
      step.struct = pointee;
    } else if (pointee == Types.LPCSTR) {
      step.kind = ArgumentKind.String;
    } else {
      step.kind = ArgumentKind.Dword;
    }
  }

  return step;
}
