import { clockOf } from '../../emulator/clock.js';

export function getTime(this: any) {
  const today = clockOf(this?._machine).date();

  return [
    today.getHours(),
    today.getMinutes(),
    today.getSeconds(),
    Math.floor(today.getMilliseconds() / 10),
  ];
}
