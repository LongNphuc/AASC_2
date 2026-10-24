/**
 * Hàng trả về của `query()`: với UPDATE/DELETE … RETURNING, TypeORM (driver
 * postgres) trả `[rows, rowCount]`; với SELECT, INSERT trả thẳng `rows`.
 */
export function returningRows<T>(result: unknown): T[] {
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
  ) {
    return result[0] as T[];
  }
  return (result ?? []) as T[];
}
