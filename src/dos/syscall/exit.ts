/**
 * INT 21h function 4Ch: the program is finished, with AL its return code.
 * DOS hands it to whoever runs the program -- under Windows, the kernel,
 * which ends the task; see `Win16.exitTask`.
 */
export function exit(this: any, code: number) {
  this.onExit?.(code);
}
