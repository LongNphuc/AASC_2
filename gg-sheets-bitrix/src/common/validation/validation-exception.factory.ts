import { BadRequestException, ValidationError } from '@nestjs/common';
import { ERROR, VALIDATION } from '../constants/messages.constant';

/**
 * Gom lỗi validate (kể cả lỗi của object lồng nhau như `address.ward`) thành
 * danh sách thông báo tiếng Việt dễ đọc, ví dụ:
 *   ["Email không hợp lệ", "bank.accountNumber: Số tài khoản không hợp lệ"]
 */
export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  return new BadRequestException({
    error: ERROR.LABEL.VALIDATION_FAILED,
    message: flatten(errors),
  });
}

function flatten(errors: ValidationError[], parentPath = ''): string[] {
  return errors.flatMap((error) => {
    const path = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const own = Object.entries(error.constraints ?? {}).map(([rule, text]) => {
      // whitelistValidation: client gửi trường không có trong DTO.
      if (rule === 'whitelistValidation') {
        return VALIDATION.FIELD_NOT_ALLOWED(path);
      }
      return parentPath ? `${path}: ${text}` : text;
    });
    return [...own, ...flatten(error.children ?? [], path)];
  });
}
