import { Transform } from 'class-transformer';

/** Bỏ khoảng trắng hai đầu chuỗi trước khi validate. */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
