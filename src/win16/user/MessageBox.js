"use strict";

import { FixedWindow } from '../../windows/fixed-window.js';

import { Label } from '../../controls/label.js';
import { Button } from '../../controls/button.js';

export function MessageBox(hwndParent, lpszText, lpszTitle, fuStyle) {
    let dialog = new FixedWindow({
        caption: lpszTitle
    });

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

    // TODO: wait until the message box closes before returning to the app
    return 1;
}
