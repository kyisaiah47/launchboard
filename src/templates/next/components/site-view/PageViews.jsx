'use client';
import { useSiteView } from './SiteViewProvider';

/** One of the two compositions of a route. Console renders until the provider reads a Simple choice. */
export default function PageViews({ consoleView, simpleView }) {
  return useSiteView()?.view === 'simple' && simpleView !== undefined ? simpleView : consoleView;
}
