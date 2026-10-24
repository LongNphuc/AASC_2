/** Số đếm thô của một nhóm (readme_design.md mục 9.1). */
export interface MetricCounts {
  interactions: number;
  submissions: number;
  leads: number;
  deals: number;
  won: number;
  lost: number;
  revenue: number;
  avgDealValue: number | null;
  avgQualityScore: number | null;
  completed: number;
  /** null khi nhóm không gắn được với chi phí (group_by ad, form, event_type). */
  spend: number | null;
}

/** Chia, mẫu bằng 0 hoặc không có thì null (không trả 0). */
export function ratio(
  numerator: number | null,
  denominator: number | null,
): number | null {
  if (numerator === null || denominator === null || denominator === 0)
    return null;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

function money(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}

/**
 * Chỉ số suy ra từ số đếm (readme_design.md mục 9.2):
 *   lead_to_deal = deals / leads · lead_to_won = won / leads
 *   win_rate = won / (won + lost) · cpl = spend / submissions
 *   cost_per_customer = spend / leads · cost_per_won = spend / won
 *   roi = (revenue − spend) / spend · completion_rate = completed / submissions
 */
export function deriveMetrics(c: MetricCounts) {
  const roi = c.spend
    ? Math.round(((c.revenue - c.spend) / c.spend) * 100) / 100
    : null;
  return {
    interactions: c.interactions,
    submissions: c.submissions,
    leads: c.leads,
    deals: c.deals,
    won: c.won,
    lost: c.lost,
    leadToDeal: ratio(c.deals, c.leads),
    leadToWon: ratio(c.won, c.leads),
    winRate: ratio(c.won, c.won + c.lost),
    revenue: Math.round(c.revenue),
    avgDealValue: money(c.avgDealValue),
    avgQualityScore:
      c.avgQualityScore === null ? null : Math.round(c.avgQualityScore),
    completed: c.completed,
    completionRate: ratio(c.completed, c.submissions),
    spend: money(c.spend),
    cpl: money(
      c.spend === null || c.submissions === 0 ? null : c.spend / c.submissions,
    ),
    costPerCustomer: money(
      c.spend === null || c.leads === 0 ? null : c.spend / c.leads,
    ),
    costPerWon: money(c.spend === null || c.won === 0 ? null : c.spend / c.won),
    roi,
  };
}

export type DerivedMetrics = ReturnType<typeof deriveMetrics>;

export function emptyCounts(spend: number | null = null): MetricCounts {
  return {
    interactions: 0,
    submissions: 0,
    leads: 0,
    deals: 0,
    won: 0,
    lost: 0,
    revenue: 0,
    avgDealValue: null,
    avgQualityScore: null,
    completed: 0,
    spend,
  };
}
