import 'reflect-metadata';
import { Container } from './container';
import { Dispatcher } from './dispatcher';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { AllExceptionsFilter } from './filters/exception.filter';
import { UserController } from './users/user.controller';
import { ProtectedController } from './protected/protected.controller';

/**
 * Складання застосунку: контейнер (частина 1) + диспетчер (частина 2) з повним
 * циклом (частина 3). Глобально вмикаємо:
 *   - `LoggingInterceptor` — заміряє тривалість кожного запиту;
 *   - `AllExceptionsFilter` — мапить помилки в HTTP (вбудований і так є, але
 *     реєструємо явно, щоб показати механізм `useFilters`).
 *
 * `AuthGuard` НЕ глобальний: він навішений на `ProtectedController` через
 * `@UseGuards`, тож `/users` лишається відкритим, а `/protected` — під захистом.
 *
 * Повертаємо і диспетчер, і контейнер — тести через контейнер доводять, що
 * сервіс у контролері й сервіс із контейнера — один і той самий singleton.
 */
export function createApp(container: Container = new Container()): {
  dispatcher: Dispatcher;
  container: Container;
} {
  const dispatcher = new Dispatcher(container)
    .useInterceptors(new LoggingInterceptor())
    .useFilters(new AllExceptionsFilter())
    .register(UserController, ProtectedController);
  return { dispatcher, container };
}
