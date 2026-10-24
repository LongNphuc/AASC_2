import { ValidationError } from '@nestjs/common';
import { ERROR, VALIDATION } from '../constants/messages.constant';
import { KbnHttpException } from '../errors/kbn-http.exception';
import { ErrorKbn } from '../kbn/error.kbn';

/**
 * Gom lỗi validate (kể cả lỗi của object lồng nhau) thành danh sách thông báo
 * dễ đọc, trả 400 với errorKbn 20001.
 */
export function validationExceptionFactory(
  errors: ValidationError[],
): KbnHttpException {
  return new KbnHttpException(
    400,
    ErrorKbn.VALIDATION,
    ERROR.LABEL.VALIDATION_FAILED,
    flattenValidationErrors(errors),
  );
}

export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): string[] {
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
    return [...own, ...flattenValidationErrors(error.children ?? [], path)];
  });
}
