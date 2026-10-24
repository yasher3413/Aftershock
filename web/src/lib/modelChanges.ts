/**
 * Moments the forecast model changed. Odds before one came from the earlier
 * model, so charts of odds over time mark them; otherwise the step looks like
 * something happened on the ice. See docs/DECISIONS.md.
 */
export const MODEL_CHANGES: { at: number; label: string }[] = [
  // New-season fade and preseason betting lines (2026-10-24).
  { at: Date.parse("2026-10-24T16:50:00Z"), label: "Model updated" },
];
