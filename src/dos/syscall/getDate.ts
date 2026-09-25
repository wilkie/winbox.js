/**
 * INT 21h function 2Ah: the date, as DOS gives it -- CX the whole year
 * (1980 to 2099), DH the month counted from 1, DL the day, and AL the day of
 * the week, Sunday 0.
 */
export function getDate() {
  const today = new Date();

  return [today.getFullYear(), today.getMonth() + 1, today.getDate(), today.getDay()];
}
