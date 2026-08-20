import 'reflect-metadata';
import type { Constructor } from '../tokens';
import type { CanActivate } from '../http/lifecycle';

/** Клас-guard, який контейнер уміє створити. */
export type GuardClass = Constructor<CanActivate>;

/** Ключ метаданих: список guard-класів на контролері або окремому методі. */
export const GUARDS_KEY = Symbol('mini-nest:guards');

/**
 * `@UseGuards(...guards)` — навісити guard(и) на контролер (усі його маршрути)
 * або на конкретний метод. Зберігає лише КЛАСИ; екземпляри диспетчер дістане з
 * контейнера в момент запиту (тож guard теж може мати залежності).
 *
 * Працює і як класовий, і як методний декоратор: якщо `propertyKey` переданий —
 * це метод, інакше — клас. reflect-metadata тримає ці два набори окремо
 * (методні — під ключем властивості), а `getGuards` зливає їх докупи.
 */
export function UseGuards(...guards: GuardClass[]): ClassDecorator & MethodDecorator {
  return ((target: object, propertyKey?: string | symbol) => {
    const ctor = propertyKey ? (target as { constructor: object }).constructor : target;
    if (propertyKey) {
      Reflect.defineMetadata(GUARDS_KEY, guards, ctor, String(propertyKey));
    } else {
      Reflect.defineMetadata(GUARDS_KEY, guards, ctor);
    }
  }) as ClassDecorator & MethodDecorator;
}

/**
 * Усі guard-класи для конкретного обробника: спершу класові (спільні для
 * контролера), потім методні. Порядок зберігаємо — так само, як у Nest.
 */
export function getGuards(controller: Constructor, methodName: string): GuardClass[] {
  const classGuards: GuardClass[] = Reflect.getMetadata(GUARDS_KEY, controller) ?? [];
  const methodGuards: GuardClass[] =
    Reflect.getMetadata(GUARDS_KEY, controller, methodName) ?? [];
  return [...classGuards, ...methodGuards];
}
