import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/**
 * Tìm khách trùng theo email HOẶC SĐT trên mọi lượt gửi cũ (readme_design.md
 * mục 4.4). Tìm trên lead_submissions chứ không trên leads: khách đổi SĐT thì
 * leads.phone mang số mới, nhưng số cũ vẫn nằm ở lượt gửi cũ.
 *
 * Email khớp khách A, SĐT khớp khách B: chọn A (email ưu tiên), không tự gộp.
 * Không cần khóa: job chạy lần lượt từng cái một (mục 10.1).
 */
@Injectable()
export class LeadDedupeService {
  async findExistingLead(
    manager: EntityManager,
    email: string | null,
    phone: string | null,
  ): Promise<string | null> {
    if (!email && !phone) return null;
    const rows = await manager.query<{ lead_uuid: string }[]>(
      `SELECT lead_uuid
         FROM lead_submissions
        WHERE email = $1 OR phone = $2
        GROUP BY lead_uuid
        ORDER BY COALESCE(bool_or(email = $1), false) DESC, min(submitted_at)
        LIMIT 1`,
      [email, phone],
    );
    return rows[0]?.lead_uuid ?? null;
  }
}
