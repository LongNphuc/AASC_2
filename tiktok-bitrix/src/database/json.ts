/**
 * Kiểu của cột jsonb dạng object. Dùng `any` cho giá trị để kiểu cập nhật
 * từng phần của TypeORM (QueryDeepPartialEntity) nhận được.
 */
export type JsonObject = Record<string, any>;

/**
 * Giá trị object ghi vào cột jsonb qua `update()`, `insert()`: kiểu cập nhật
 * từng phần của TypeORM duyệt sâu vào object và không nhận object lồng nhau
 * tùy ý, nên trả `never` (gán được cho mọi kiểu cột).
 */
export function jsonValue(value: JsonObject): never {
  return value as never;
}
