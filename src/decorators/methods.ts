import 'reflect-metadata';

/** HTTP-методи, які вміє наш маршрутизатор. */
export type HttpMethod = 'GET' | 'POST';

/** Опис одного маршруту, зібраний з декоратора методу. */
export interface RouteDefinition {
  /** HTTP-метод: GET | POST. */
  method: HttpMethod;
  /** Шлях методу (без префікса контролера), нормалізований. */
  path: string;
  /** Імʼя методу-обробника на контролері. */
  handlerName: string;
}

/** Ключ метаданих: список маршрутів, накопичений на класі контролера. */
export const ROUTES_KEY = Symbol('mini-nest:routes');

/**
 * Фабрика декораторів методів. `@Get(path)` / `@Post(path)` не роблять нічого,
 * крім запису одного пункту в список маршрутів контролера.
 *
 * Важлива деталь про `target`: у декоратора **методу** `target` — це прототип
 * класу, тому клас-конструктор дістаємо через `target.constructor`. Саме на
 * конструкторі й зберігаємо метадані маршрутів — там само, де диспетчер їх шукає
 * (поруч із префіксом контролера й мапою параметрів).
 *
 * Повний шлях НЕ склеюється тут: декоратор методу не знає префікса свого
 * контролера (декоратор класу ще навіть не відпрацював — він виконується
 * ПІСЛЯ декораторів методів). Склейку робить `router.ts`, коли всі метадані
 * вже на місці.
 */
function createMappingDecorator(method: HttpMethod) {
  return (path = ''): MethodDecorator => {
    return (target, propertyKey) => {
      const ctor = (target as { constructor: object }).constructor;
      const routes: RouteDefinition[] =
        Reflect.getOwnMetadata(ROUTES_KEY, ctor) ?? [];
      routes.push({
        method,
        path: normalizePath(path),
        handlerName: String(propertyKey),
      });
      Reflect.defineMetadata(ROUTES_KEY, routes, ctor);
    };
  };
}

/** `@Get(path?)` — реєструє GET-маршрут. */
export const Get = createMappingDecorator('GET');

/** `@Post(path?)` — реєструє POST-маршрут. */
export const Post = createMappingDecorator('POST');

/** Прочитати всі маршрути, оголошені на класі контролера. */
export function getRoutes(target: object): RouteDefinition[] {
  return Reflect.getOwnMetadata(ROUTES_KEY, target) ?? [];
}

/**
 * Нормалізуємо шлях методу: провідний `/`, без хвостового.
 * `':id'` → `'/:id'`, `''`/`'/'` → `''` (метод монтується в сам префікс).
 */
function normalizePath(path: string): string {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? '' : `/${trimmed}`;
}
