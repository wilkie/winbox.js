"use strict";

import { FixedWindow } from '../../windows/fixed-window.js';

import { Label } from '../../controls/label.js';
import { Button } from '../../controls/button.js';

import { User } from '../user.js';

export async function MessageBox(hwndParent, lpszText, lpszTitle, fuStyle) {
    // Stop the task
    this.scheduler.task.halt();

    // Get the parent window
    const parentWindow = this.handles.resolve(hwndParent);

    // Create a dialog box
    const dialog = new FixedWindow({
        caption: lpszTitle,
        font: this.fonts.lookup("System"),
        size: 8,
        width: 800
    });

    // And place a label on it for the message text
    const label = new Label({
        caption: lpszText,
        font: this.fonts.lookup("System"),
        size: 8,
        width: 800
    });

    label.fitted = true;
    label.move(16, 16);

    dialog.append(label);

    const buttons = {};

    // TODO: Negotiate which buttons are visible
    if (fuStyle & User.MB_OK) {
    }

    if (fuStyle & User.MB_OKCANCEL) {
    }

    if (fuStyle & User.MB_RETRYCANCEL) {
    }

    if (fuStyle & User.MB_ABORTRETRYIGNORE) {
    }

    if (fuStyle & User.MB_YESNO) {
    }

    if (fuStyle & User.MB_YESNOCANCEL) {
    }

    // Negotiate the default button
    if (fuStyle & User.DEFBUTTON1) {
    }
    else if (fuStyle & User.DEFBUTTON2) {
    }
    else if (fuStyle & User.DEFBUTTON3) {
    }

    // Negotiate the icon to be used
    if (fuStyle & User.ICONSTOP) {
    }

    if (fuStyle & User.ICONINFORMATION) {
    }

    if (fuStyle & User.ICONQUESTION) {
    }

    if (fuStyle & User.ICONEXCLAMATION) {
    }

    const button = new Button({
        caption: "Ok"
    });

    button.resize(48, 24);

    dialog.append(button);

    buttons[User.IDOK] = button;

    this._desktop.append(dialog);

    label.fit();

    console.log(label.width);

    const width = label.width + 32;

    dialog.resize(width, (dialog.height - dialog.innerHeight) + 82);

    button.move((width - button.width) / 2, 36 + label.innerHeight);

    dialog.center();

    dialog.focus();

    const msgBoxHandle = this.handles.allocate(dialog);
    this.windows.halt(hwndParent, msgBoxHandle);

    // Wait until the message box closes before returning to the app
    return new Promise( (resolve) => {
        // Return value is the button that was pressed
        [User.IDOK, User.IDABORT, User.IDCANCEL, User.IDIGNORE, User.IDNO,
         User.IDYES, User.IDRETRY].forEach( (id) => {
            const button = buttons[id];
            if (button) {
                button.on("click", () => {
                    dialog.destroy();
                    this.handles.free(msgBoxHandle);
                    this.windows.halt(hwndParent, null);
                    resolve(id);
                });
            }
         });
    });
}
