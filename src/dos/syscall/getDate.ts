export function getDate() {
    const today = new Date();

    return [(today as any).getYear(), today.getMonth(), today.getDate(), today.getDay()];
}
