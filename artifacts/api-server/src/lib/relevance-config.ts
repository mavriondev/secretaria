/** Thresholds for the relevance filter. A candidate below its threshold is never offered to the composition step. */
export const relevanceConfig = {
  /** Minimum absolute variation (%) against the previous equivalent period to comment on it. */
  minVariationPct: 5,
  /** Minimum end-to-end variation (%) across the monthly series to comment on a monthly trend. */
  minMonthlyTrendPct: 5,
  /** Minimum share (%) of the total held by the leading client/product/debtor to comment on concentration. */
  minConcentrationPct: 25,
  /** Minimum share (%) of overdue value older than 90 days to comment on long overdue amounts. */
  minLongOverduePct: 20,
  /** Minimum days past due of the largest debtor to comment on it. */
  minOverdueDays: 60,
  /** Maximum candidates handed to the composition step per turn. */
  maxCandidates: 4,
  /** Composition call deadline in milliseconds; on timeout the deterministic text is used. */
  compositionTimeoutMs: 9000,
};
export type RelevanceConfig = typeof relevanceConfig;
