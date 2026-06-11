/**
 * Service teardown — called on SIGINT/SIGTERM after runPhases() completes.
 *
 * For M4, stub phases own no services: agent sessions and bash process groups
 * are torn down automatically via the AbortSignal chain
 * (scheduler → runner → runBash). This hook is the seam for Phase 5's
 * start_service guaranteed-teardown contract; when start_service lands it
 * registers its cleanup here.
 *
 * PRD §3.4.4: "cancellation disposes agent sessions and kills child process groups;
 * Phase 5 services torn down (delegated to start_service's guaranteed-teardown contract)."
 */
export function teardownServices(): void {
  // no-op: stub phases own no services.
}
