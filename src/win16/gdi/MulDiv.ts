'use strict';

/**
 * The **MulDiv** function multiplies two 16-bit values and divides the 32-bit
 * product by a third, rounding to the nearest integer.
 *
 * As documented, not yet recorded: a result that overflows 16 bits, or a
 * division by zero, answers 32767, or -32768 when the result would be
 * negative. How a half rounds is not documented; it rounds away from zero
 * here, and a probe would settle it.
 *
 * @param {Types.INT} nMultiplicand - The value to multiply.
 * @param {Types.INT} nMultiplier - What to multiply it by.
 * @param {Types.INT} nDivisor - What to divide the product by.
 *
 * @returns {Types.INT} The result, or 32767 or -32768 on overflow.
 */
export function MulDiv(nMultiplicand, nMultiplier, nDivisor) {
  const sign = (value: number) => (value << 16) >> 16;
  const product = sign(nMultiplicand) * sign(nMultiplier);
  const divisor = sign(nDivisor);

  if (divisor === 0) {
    return product < 0 ? -32768 : 32767;
  }

  const exact = product / divisor;
  const result = Math.sign(exact) * Math.round(Math.abs(exact));

  if (result > 32767) {
    return 32767;
  }

  if (result < -32768) {
    return -32768;
  }

  return result;
}
