export function selectDisk(index) {
    // Set the current drive letter
    let drive = String.fromCharCode(index + "A".charCodeAt(0));

    // Set the current drive
    if (this.drive != drive) {
        this.drive = drive;
    }
}
