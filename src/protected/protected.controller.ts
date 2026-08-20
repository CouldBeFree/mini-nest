import { Controller } from '../decorators/controller';
import { Get } from '../decorators/methods';
import { UseGuards } from '../decorators/use-guards';
import { AuthGuard } from '../guards/auth.guard';
import { getRequestId } from '../context/request-context';

/**
 * Демо захищеного ресурсу. `@UseGuards(AuthGuard)` на класі вимагає заголовок
 * `Authorization: Bearer <token>` для всіх його маршрутів. Без нього диспетчер
 * відповість `403` ще до обробника; решта застосунку (напр. `/users`) лишається
 * відкритою — guard навішено точково, а не глобально.
 */
@Controller('protected')
@UseGuards(AuthGuard)
export class ProtectedController {
  /** GET /protected — доступний лише авторизованим; повертає id поточного запиту. */
  @Get()
  secret() {
    return { secret: true, requestId: getRequestId() };
  }
}
