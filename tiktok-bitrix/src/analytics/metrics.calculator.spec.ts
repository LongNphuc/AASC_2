import {
  deriveMetrics,
  emptyCounts,
  ratio,
} from './services/metrics.calculator';

describe('metrics.calculator', () => {
  it('ratio làm tròn 4 chữ số; mẫu 0 hoặc null thì null', () => {
    expect(ratio(1, 3)).toBe(0.3333);
    expect(ratio(1, 0)).toBeNull();
    expect(ratio(null, 3)).toBeNull();
    expect(ratio(1, null)).toBeNull();
  });

  it('công thức mục 9.2', () => {
    const metrics = deriveMetrics({
      interactions: 100,
      submissions: 40,
      leads: 30,
      deals: 12,
      won: 6,
      lost: 2,
      revenue: 60_000_000,
      avgDealValue: 7_499_999.6,
      avgQualityScore: 64.6,
      completed: 10,
      spend: 2_000_000,
    });
    expect(metrics).toEqual({
      interactions: 100,
      submissions: 40,
      leads: 30,
      deals: 12,
      won: 6,
      lost: 2,
      leadToDeal: 0.4,
      leadToWon: 0.2,
      winRate: 0.75,
      revenue: 60_000_000,
      avgDealValue: 7_500_000,
      avgQualityScore: 65,
      completed: 10,
      completionRate: 0.25,
      spend: 2_000_000,
      cpl: 50_000,
      costPerCustomer: 66_667,
      costPerWon: 333_333,
      roi: 29,
    });
  });

  it('nhóm rỗng, không có chi phí: chỉ số là null, không phải 0', () => {
    expect(deriveMetrics(emptyCounts())).toMatchObject({
      leadToDeal: null,
      winRate: null,
      completionRate: null,
      spend: null,
      cpl: null,
      costPerCustomer: null,
      costPerWon: null,
      roi: null,
      avgDealValue: null,
      avgQualityScore: null,
    });
    expect(deriveMetrics(emptyCounts(500))).toMatchObject({
      spend: 500,
      cpl: null,
      roi: -1,
    });
  });
});
