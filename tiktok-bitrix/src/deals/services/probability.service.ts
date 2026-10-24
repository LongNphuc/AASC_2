import { Injectable } from '@nestjs/common';
import { fromBitrixStage } from './stage-code';

/** Điểm chất lượng cộng hoặc trừ xác suất khi tạo deal (mục 6.3). */
const HIGH_SCORE = 70;
const LOW_SCORE = 40;
const SCORE_ADJUST = 10;

/**
 * Xác suất của deal (readme_design.md mục 6.3): xác suất do ứng dụng tính theo
 * stage, còn stage, giá trị, người phụ trách do Bitrix24 làm chủ sau khi tạo.
 */
@Injectable()
export class ProbabilityService {
  /**
   * Khi tạo: probability của rule (không có thì theo stage), cộng 10 nếu điểm
   * ≥ 70, trừ 10 nếu < 40, giới hạn 0–100. Mẫu của đề: 30 + 10 (điểm 75) = 40.
   */
  initial(
    ruleProbability: number | undefined,
    stageProbability: Record<string, Record<string, number>>,
    pipelineId: string,
    stage: string,
    qualityScore: number,
  ): number {
    const base =
      ruleProbability ??
      stageProbability[pipelineId]?.[fromBitrixStage(stage)] ??
      0;
    const adjust =
      qualityScore >= HIGH_SCORE
        ? SCORE_ADJUST
        : qualityScore < LOW_SCORE
          ? -SCORE_ADJUST
          : 0;
    return clamp(base + adjust);
  }

  /**
   * Khi deal đổi stage: giá trị của stage mới; thắng là 100, thua là 0. Stage
   * không có trong cấu hình thì null (giữ giá trị trên Bitrix24).
   */
  forStage(
    stageProbability: Record<string, Record<string, number>>,
    pipelineId: string,
    stageId: string,
    semantic: string | undefined,
  ): number | null {
    if (semantic === 'S') return 100;
    if (semantic === 'F') return 0;
    const value = stageProbability[pipelineId]?.[fromBitrixStage(stageId)];
    return value === undefined ? null : clamp(value);
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
