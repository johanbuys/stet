/**
 * Human-readable output renderer for stet RunReports.
 *
 * Pure function — no I/O, no process access. Callers supply the color flag
 * after checking process.stdout.isTTY and NO_COLOR (plan M9, PRD §3.8, §2a).
 *
 * Format:
 *   Per-phase block: name + status, reason (if skipped/cancelled/error), findings.
 *   Each finding: severity (colored) · id · message · file:line (when present).
 *   Result line: exit code + label · fail-on.
 *   Cost footer: token counts · elapsed time.
 */

import type { RunReport } from "../schema/report.js";
import { severityAtLeast, type Severity } from "../schema/finding.js";
import { exitLabel } from "../exit-codes.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface HumanRenderOptions {
  /** Enable ANSI color codes. Set false when not a TTY or NO_COLOR is set. */
  color: boolean;
  /**
   * Suppress passing phases (completed with no findings) from the output.
   * PRD §3.8 --quiet.
   */
  quiet?: boolean;
  /**
   * Only display findings at this severity or above.
   * Ordering: error > warning > info. --show warning shows error + warning.
   * PRD §3.8 --show <severity>.
   */
  show?: Severity;
}

/**
 * Render a RunReport as a human-friendly multi-line string.
 *
 * Returns a single string (caller writes it as one stdout call). No trailing
 * newline — the caller appends one when writing to the terminal.
 */
export function renderHuman(report: RunReport, opts: HumanRenderOptions): string {
  const { color, quiet = false, show } = opts;
  const lines: string[] = [];

  for (const phase of report.phases) {
    // --quiet: skip phases that passed (completed, no findings in the original report).
    if (quiet && phase.status === "completed" && phase.findings.length === 0) {
      continue;
    }

    // Per-phase finding count (original count — honest under --show) in the header.
    const n = phase.findings.length;
    const countSuffix = n > 0 ? `  (${n} finding${n === 1 ? "" : "s"})` : "";
    lines.push(`── ${phase.phase}  ${phase.status}${countSuffix} ──`);

    if (phase.reason !== undefined) {
      lines.push(`  reason: ${phase.reason}`);
    }

    // --show: filter findings to those at or above the requested severity.
    const visibleFindings =
      show !== undefined
        ? phase.findings.filter((f) => severityAtLeast(f.severity, show))
        : phase.findings;

    if (visibleFindings.length === 0) {
      if (phase.findings.length > 0 && show !== undefined) {
        // Findings existed but were all hidden by --show: never report as clean.
        lines.push(
          `  ${phase.findings.length} finding${phase.findings.length === 1 ? "" : "s"} hidden by --show ${show}`,
        );
      } else {
        lines.push("  no findings");
      }
    } else {
      for (const finding of visibleFindings) {
        const sev = colorSeverity(finding.severity, color);
        let loc = "";
        if (finding.location !== undefined) {
          loc = `  ${finding.location.file}`;
          if (finding.location.line !== undefined) {
            loc += `:${finding.location.line}`;
          }
        }
        lines.push(`  ${sev}  ${finding.id} — ${finding.message}${loc}`);
      }
    }

    lines.push("");
  }

  const { exitCode, failOn } = report.result;
  lines.push(`result: exit ${exitCode} (${exitLabel(exitCode)}) · fail-on: ${failOn}`);
  lines.push("");

  const { totalInputTokens, totalOutputTokens, durationMs } = report.cost;
  const durationSec = (durationMs / 1000).toFixed(1);
  lines.push(`cost: ${totalInputTokens} in / ${totalOutputTokens} out tokens · ${durationSec}s`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// ANSI color helpers
// ---------------------------------------------------------------------------

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const SEVERITY_COLOR: Record<Severity, string> = {
  error: RED,
  warning: YELLOW,
  info: DIM,
};

function colorSeverity(severity: Severity, color: boolean): string {
  return color ? `${SEVERITY_COLOR[severity]}${severity}${RESET}` : severity;
}
