/** The page's published state read by the components, each re-rendered as what it reads is replaced. */

import { useSyncExternalStore } from 'react';
import { pageView, statusLine, traceView } from '../page/state.js';

export const usePageView = () => useSyncExternalStore(pageView.subscribe, pageView.get);
export const useTrace = () => useSyncExternalStore(traceView.subscribe, traceView.get);
export const useStatusLine = () => useSyncExternalStore(statusLine.subscribe, statusLine.get);
