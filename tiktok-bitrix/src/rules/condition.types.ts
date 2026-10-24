export type ConditionValue = string | number;

export type CompareOp =
  '=' | '!=' | '>' | '>=' | '<' | '<=' | 'CONTAINS' | 'NOT CONTAINS' | 'IN';

/** Cây điều kiện sau khi phân tích (readme_design.md mục 6.1). */
export type ConditionNode =
  | { kind: 'all' }
  | { kind: 'or'; items: ConditionNode[] }
  | { kind: 'and'; items: ConditionNode[] }
  | {
      kind: 'compare';
      path: string;
      op: CompareOp;
      value: ConditionValue | ConditionValue[];
    }
  | { kind: 'exists'; path: string };

/** Lỗi cú pháp, kèm vị trí (ký tự, tính từ 0) trong chuỗi điều kiện. */
export class ConditionSyntaxError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
    this.name = 'ConditionSyntaxError';
  }
}
