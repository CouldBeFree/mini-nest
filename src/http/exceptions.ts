/**
 * Ієрархія помилок, які знають свій HTTP-статус. Обробник (чи будь-який шар
 * нижче) кидає доменну помилку — `throw new NotFoundError(...)` — і НЕ думає про
 * коди статусів; перетворення на HTTP робить один Exception Filter наприкінці
 * циклу (див. `src/filters/exception.filter.ts`). Так статус-коди не розповзаються
 * по всьому коду, а живуть в одному місці.
 */

/** Базова помилка з HTTP-статусом. Усе, що від неї успадковано, фільтр мапить
 *  напряму у відповідь `{ statusCode, message }`. */
export class HttpException extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** `400` — синтаксично/логічно кривий запит. */
export class BadRequestError extends HttpException {
  constructor(message = 'Bad Request') {
    super(400, message);
  }
}

/** `400` — тіло не є валідним JSON (обрив читання, биті дужки тощо). Окремий
 *  клас, щоб фільтр міг відрізнити «кривий JSON» від «валідний JSON, але не
 *  проходить правила DTO» (це `ValidationError`). */
export class MalformedJsonError extends BadRequestError {
  constructor(message = 'Malformed JSON in request body') {
    super(message);
  }
}

/** `401` — немає/невалідні облікові дані. */
export class UnauthorizedError extends HttpException {
  constructor(message = 'Unauthorized') {
    super(401, message);
  }
}

/** `403` — автентифікований, але доступ заборонено (сюди мапиться відмова guard). */
export class ForbiddenError extends HttpException {
  constructor(message = 'Forbidden') {
    super(403, message);
  }
}

/** `404` — ресурсу немає. Доменна помилка: `throw new NotFoundError('User 7 not found')`. */
export class NotFoundError extends HttpException {
  constructor(message = 'Not Found') {
    super(404, message);
  }
}

/** `413` — тіло запиту перевищило ліміт байтів. */
export class PayloadTooLargeError extends HttpException {
  constructor(public readonly limit: number) {
    super(413, `Request body exceeds limit of ${limit} bytes`);
  }
}

/** Одне поле з помилкою валідації: назва + список причин (усі порушені правила). */
export interface FieldError {
  field: string;
  constraints: string[];
}

/**
 * `400` валідації. На відміну від решти — несе структурований `errors` (список
 * полів), щоб клієнт побачив, ЩО саме не так, а не тільки «Bad Request». Фільтр
 * віддає цей список у тілі відповіді.
 */
export class ValidationError extends HttpException {
  constructor(public readonly errors: FieldError[]) {
    super(400, 'Validation failed');
  }
}
