/**
 * ANSI escape code helpers for the ClawMesh TUI.
 * Zero dependencies — just string constants and pure functions.
 */

export const ESC = "\x1b";
export const CSI = `${ESC}[`;

// ── Screen management ─────────────────────────────────────
export const ALT_ON = `${CSI}?1049h`;
export const ALT_OFF = `${CSI}?1049l`;
export const CUR_HIDE = `${CSI}?25l`;
export const CUR_SHOW = `${CSI}?25h`;
export const HOME = `${CSI}H`;
export const CLR_LINE = `${CSI}2K`;

// ── Text styles ───────────────────────────────────────────
export const RST = `${CSI}0m`;
export const BOLD = `${CSI}1m`;
export const DIM = `${CSI}2m`;

// ── 24-bit color helpers ──────────────────────────────────
export function fg(r: number, g: number, b: number): string {
  return `${CSI}38;2;${r};${g};${b}m`;
}
export function bg(r: number, g: number, b: number): string {
  return `${CSI}48;2;${r};${g};${b}m`;
}

// ── ClawMesh brand palette (matches web UI globals.css) ───
export const C = {
  orange: fg(255, 120, 68),
  orangeBright: fg(255, 149, 107),
  green: fg(90, 216, 127),
  cyan: fg(69, 176, 203),
  red: fg(255, 93, 77),
  yellow: fg(255, 191, 92),
  white: fg(237, 243, 255),
  dim: fg(120, 130, 150),
  vdim: fg(60, 70, 90),
  border: fg(50, 60, 80),
};

// ── Box-drawing characters ────────────────────────────────
export const B = {
  tl: "┌", tr: "┐", bl: "└", br: "┘",
  h: "─", v: "│",
  lt: "├", rt: "┤", tt: "┬", bt: "┴",
  x: "┼",
} as const;

// ── String width / truncation helpers ─────────────────────
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Strip all ANSI escape codes from a string. */
export function strip(s: string): string {
  return s.replace(ANSI_RE, "");
}

/** Display width (visible character count, ignoring ANSI codes). */
export function dw(s: string): number {
  return strip(s).length;
}

/** Pad a styled string to exact display width with trailing spaces. */
export function pad(s: string, w: number): string {
  if (w <= 0) return "";
  const d = dw(s);
  return d >= w ? s : s + " ".repeat(w - d);
}

/**
 * Truncate a styled string to max display width.
 * Preserves ANSI codes but cuts visible characters, adding '…' if truncated.
 */
export function trunc(s: string, w: number): string {
  if (w <= 0) return "";
  if (dw(s) <= w) return s;
  let vis = 0;
  let r = "";
  let i = 0;
  const limit = w - 1; // reserve 1 char for '…'
  while (i < s.length && vis < limit) {
    if (s[i] === "\x1b") {
      const end = s.indexOf("m", i);
      if (end >= 0) {
        r += s.slice(i, end + 1);
        i = end + 1;
      } else {
        i++;
      }
    } else {
      r += s[i];
      vis++;
      i++;
    }
  }
  return r + "…" + RST;
}

/** Fit a styled string to exact display width: truncate if too long, pad if too short. */
export function fit(s: string, w: number): string {
  if (w <= 0) return "";
  return pad(trunc(s, w), w);
}
