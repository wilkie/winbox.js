export function getDate() {
    let today = new Date();

    return [today.getYear(), today.getMonth(), today.getDate(), today.getDay()];
}
