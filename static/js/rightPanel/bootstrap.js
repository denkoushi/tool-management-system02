import { bootstrapLegacy } from './pageLegacy.js';
import { initRightPanel } from './initRightPanel.js';

export function bootstrapRightPanel() {
  const context = initRightPanel() || {};
  try {
    bootstrapLegacy({ socket: context.socket });
  } catch (err) {
    console.error('Failed to bootstrap legacy features', err);
  }
}
