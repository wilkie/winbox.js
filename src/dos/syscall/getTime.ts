export function getTime() {
  const today = new Date();

  return [
    today.getHours(),
    today.getMinutes(),
    today.getSeconds(),
    Math.floor(today.getMilliseconds() / 10),
  ];
}
