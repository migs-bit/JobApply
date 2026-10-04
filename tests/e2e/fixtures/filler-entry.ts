// Exposes the filler on window so its guards can be tested directly with
// crafted instructions (e.g. a selector that now points at a password field).
import { applyFill } from '../../../src/content/filler/dom-filler';

(window as unknown as { __applyFill: typeof applyFill }).__applyFill = applyFill;
