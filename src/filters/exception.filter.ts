import { HttpResponse, type ExceptionFilter, type ExecutionContext } from '../http/lifecycle';
import { HttpException, ValidationError } from '../http/exceptions';

/**
 * Exception Filter — остання ланка циклу. Ловить **будь-яку** помилку з ланцюга
 * (guard / interceptor / pipe / handler або читання тіла) і перетворює її на
 * `HttpResponse`. Це єдине місце, де помилка стає HTTP-статусом, тож решта коду
 * просто кидає доменні помилки й нічого не знає про коди.
 *
 * Мапінг:
 *   ValidationError        → 400 + список полів `errors`
 *   NotFoundError          → 404 з осмисленим повідомленням
 *   інші HttpException     → їхній власний статус (401/403/413/...)
 *   будь-що інше           → 500, БЕЗ повідомлення й стек-трейсу назовні
 *
 * Ключова безпекова деталь: для «несподіваних» помилок (звичайний `Error`)
 * клієнту йде рівно `{ statusCode: 500, message: 'Internal Server Error' }` —
 * ні тексту помилки, ні стеку. Справжню причину лишаємо в лозі СЕРВЕРА, щоб
 * розробник її бачив, а зловмисник — ні.
 */
export class AllExceptionsFilter implements ExceptionFilter {
  catch(err: unknown, _ctx?: ExecutionContext): HttpResponse {
    // Валідація несе структуру — віддаємо список полів, а не тільки статус.
    if (err instanceof ValidationError) {
      return new HttpResponse(400, {
        statusCode: 400,
        message: err.message,
        errors: err.errors,
      });
    }

    // Решта «очікуваних» помилок самі знають свій статус і повідомлення.
    if (err instanceof HttpException) {
      return new HttpResponse(err.status, {
        statusCode: err.status,
        message: err.message,
      });
    }

    // Несподіване: назовні — глухий 500, у лог сервера — справжня причина.
    console.error('[exception] необроблена помилка:', err);
    return new HttpResponse(500, {
      statusCode: 500,
      message: 'Internal Server Error',
    });
  }
}
