'use strict';

import { Win16 } from './win16.js';

declare global {
  interface Window {
    Win16: typeof Win16;
  }
}

window.Win16 = Win16;
