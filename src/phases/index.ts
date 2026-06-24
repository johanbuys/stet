/**
 * Phase registry — default phase set and public surface.
 *
 * DEFAULT PHASE SET NOTE: while the harness is the only thing built, the default set IS
 * the stubs (stub-det). Real phases will displace them from this set as their feature PRDs
 * are implemented. The steel-thread integration test registers stubs *explicitly* via
 * registerPhase — it never relies on the default set — so it keeps passing unchanged when
 * real phases later displace the stubs from here (plan §2, decision P10).
 *
 * Usage:
 *   import { registerDefaultPhases, registerPhase, stubDet } from "./phases/index.js";
 *   registerDefaultPhases(); // CLI entry point calls this at startup (T6)
 */

import { registerPhase } from "./registry.js";
import { stubDet } from "./stub-det.js";
import type { PhaseConfiguration } from "./types.js";

// --- Phase abstraction types ---
export type { ActivationContext, PhaseConfiguration, PhaseContext } from "./types.js";

// --- Registry ---
export { registerPhase, registeredPhases, resetRegistry } from "./registry.js";

// --- Stub phases (permanent product surface, PRD §3.9) ---
export { stubDet } from "./stub-det.js";

// --- Review phase factory (M4 — bugs specialist + verify, registered in cli.ts entry block) ---
export {
  makeReviewPhase,
  BUGS_SPECIALIST,
  REVIEW_VERIFY_CONFIG,
  MAX_FINDINGS,
} from "./review/review.js";

/**
 * The explicit default phase set.
 * This is the set the CLI registers at startup (via registerDefaultPhases).
 *
 * Current contents: deterministic stub phase only.
 * Agent phases (stub-agent, review) require a live AgentRunner and model at
 * construction time, so they are registered in the CLI entry block (cli.ts)
 * via registerPhase() rather than here — this keeps the array side-effect-free
 * and the module import lightweight (plan §2a/P10, decision P10).
 */
export const defaultPhases: PhaseConfiguration[] = [stubDet];

/**
 * Register all default phases into the registry.
 * Called by the CLI entry point (T6) once at startup.
 * Safe to call multiple times — duplicate-id behavior replaces in-place (last wins).
 */
export function registerDefaultPhases(): void {
  for (const phase of defaultPhases) {
    registerPhase(phase);
  }
}
