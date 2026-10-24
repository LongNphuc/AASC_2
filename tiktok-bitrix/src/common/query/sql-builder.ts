/**
 * Dựng mệnh đề WHERE với tham số đánh số ($1, $2…) cho truy vấn SQL viết tay
 * (danh sách có lọc, thống kê). Giá trị luôn đi qua tham số, không ghép chuỗi.
 */
export class SqlParams {
  readonly values: unknown[] = [];
  private readonly conditions: string[] = [];

  /** Thêm một giá trị, trả placeholder ($n). */
  param(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }

  /** Thêm điều kiện khi `value` có giá trị; `build` nhận placeholder. */
  where(value: unknown, build: (placeholder: string) => string): this {
    if (value !== undefined && value !== null && value !== '') {
      this.conditions.push(build(this.param(value)));
    }
    return this;
  }

  /** Thêm điều kiện không cần tham số. */
  raw(condition: string): this {
    this.conditions.push(condition);
    return this;
  }

  get clause(): string {
    return this.conditions.length
      ? `WHERE ${this.conditions.join(' AND ')}`
      : '';
  }

  /** Các điều kiện nối bằng AND, không có chữ WHERE (để lồng vào truy vấn con). */
  get conditionsOnly(): string {
    return this.conditions.length ? this.conditions.join(' AND ') : 'TRUE';
  }
}
