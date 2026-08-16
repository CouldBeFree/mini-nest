import 'reflect-metadata';
import { Container } from './container';
import { Dispatcher } from './dispatcher';
import { UserController } from './users/user.controller';

/**
 * Складання застосунку: один контейнер (частина 1) + диспетчер (частина 2) з
 * зареєстрованими контролерами. Повертаємо і диспетчер, і контейнер — тести
 * використовують контейнер, щоб довести, що сервіс у контролері й сервіс із
 * контейнера — один і той самий singleton.
 */
export function createApp(container: Container = new Container()): {
  dispatcher: Dispatcher;
  container: Container;
} {
  const dispatcher = new Dispatcher(container).register(UserController);
  return { dispatcher, container };
}
