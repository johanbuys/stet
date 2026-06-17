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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface HumanRenderOptions {
  /** Enable ANSI color codes. Set false when not a TTY or NO_COLOR is set. */
  color: boolean;
}

/**
 * Render a RunReport as a human-friendly multi-line string.
 *
 * Returns a single string (caller writes it as one stdout call). No trailing
 * newline — the caller appends one when writing to the terminal.
 */
export function renderHuman(report: RunReport, opts: HumanRenderOptions): string {
  const { color } = opts;
  const lines: string[] = [];

  for (const phase of report.phases) {
    lines.push(`── ${phase.phase}  ${phase.status} ──`);

    if (phase.reason !== undefined) {
      lines.push(`  reason: ${phase.reason}`);
    }

    if (phase.findings.length === 0) {
      lines.push("  no findings");
    } else {
      for (const finding of phase.findings) {
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
  const exitLabel = exitCode === 0 ? "ok" : exitCode === 1 ? "findings gate" : "interrupted";
  lines.push(`result: exit ${exitCode} (${exitLabel}) · fail-on: ${failOn}`);
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

function ansi(code: string, text: string, color: boolean): string {
  return color ? `${code}${text}${RESET}` : text;
}

function colorSeverity(severity: string, color: boolean): string {
  if (severity === "error") return ansi(RED, severity, color);
  if (severity === "warning") return ansi(YELLOW, severity, color);
  return ansi(DIM, severity, color);
}
