"use strict";

import { FixedWindow } from '../../windows/fixed-window.js';

import { Label } from '../../controls/label.js';
import { Button } from '../../controls/button.js';

export function MessageBox(hwndParent, lpszText, lpszTitle, fuStyle) {
    // Stop the task
    this.scheduler.task.halt();

    // Get the parent window
    let parentWindow = this.handles.resolve(hwndParent);

    // Create a dialog box
    let dialog = new FixedWindow({
        caption: lpszTitle
    });

    // And place a label on it for the message text
    let label = new Label({
        caption: lpszText
    });

    label.fitted = true;
    label.move(16, 16);

    dialog.append(label);

    // TODO: interact with fuStyle
    let button = new Button({
        caption: "Ok"
    });

    button.resize(48, 24);

    dialog.append(button);

    this._desktop.append(dialog);

    label.fit();

    console.log(label.width);

    let width = label.width + 32;

    dialog.resize(width, (dialog.height - dialog.innerHeight) + 82);

    button.move((width - button.width) / 2, 36 + label.innerHeight);

    dialog.center();

    dialog.focus();

    let msgBoxHandle = this.handles.allocate(dialog);
    this.windows.halt(hwndParent, msgBoxHandle);

    // TODO: wait until the message box closes before returning to the app
    return new Promise( (resolve) => {
        // Return value is the button that was pressed
        button.on("click", () => {
            dialog.destroy();
            this.handles.free(msgBoxHandle);
            this.windows.halt(hwndParent, null);
            resolve(1);
        });
    });
}
