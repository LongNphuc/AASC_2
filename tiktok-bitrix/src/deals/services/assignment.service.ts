import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../common/redis/redis.module';
import type { AssignmentRule } from '../../configurations/types/configuration.types';
import { evaluateCondition } from '../../rules/condition-evaluator';
import { parseCondition } from '../../rules/condition-parser';

/** Người được giao và việc tăng lượt chia, gọi sau khi dòng deal đã commit. */
export interface AssignmentPick {
  userId: number | null;
  advance: () => Promise<void>;
}

const noop = () => Promise.resolve();

/**
 * Gán sales (readme_design.md mục 6.5): assignment_rules duyệt theo thứ tự,
 * rule đầu tiên khớp cho danh sách user_ids, chia vòng tròn bằng bộ đếm Redis
 * rr:assign:{index}. Chỉ đọc lượt hiện tại; bộ đếm tăng sau khi commit
 * (advance), nên bước chạy lại hoặc yêu cầu chuyển tay bị từ chối không làm
 * lệch vòng chia. Job chạy lần lượt (mục 10.1) nên đọc rồi tăng sau vẫn đúng.
 * Mất Redis thì bộ đếm về 0, chỉ lệch lượt chia.
 */
@Injectable()
export class AssignmentService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async pick(
    rules: AssignmentRule[],
    context: Record<string, unknown>,
  ): Promise<AssignmentPick> {
    const index = rules.findIndex((rule) =>
      evaluateCondition(parseCondition(rule.condition), context),
    );
    if (index < 0 || rules[index].user_ids.length === 0) {
      return { userId: null, advance: noop };
    }
    const users = rules[index].user_ids;
    const key = `rr:assign:${index}`;
    let turn = 0;
    try {
      turn = Number(await this.redis.get(key)) || 0;
    } catch {
      // Redis lỗi: giao cho người đầu danh sách, không làm hỏng job.
    }
    return {
      userId: users[turn % users.length],
      advance: async () => {
        await this.redis.incr(key).catch(() => undefined);
      },
    };
  }
}
