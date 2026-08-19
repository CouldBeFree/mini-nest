import 'reflect-metadata';

/** Звідки диспетчер має взяти значення аргументу. */
export type ParamSource = 'body' | 'param' | 'query';

/** Одна клітинка мапи параметрів: тип джерела + (для param/query) імʼя ключа. */
export interface ParamMeta {
  source: ParamSource;
  /** Імʼя маршрут-параметра або query-ключа. Для `@Body()` не потрібне. */
  name?: string;
}

/** Мапа `parameterIndex -> звідки брати`. Ключ — індекс аргументу методу. */
export type ParamMap = Record<number, ParamMeta>;

/**
 * Ключ метаданих: `{ [methodName]: ParamMap }` на класі контролера.
 * Один клас має багато методів, тому параметри групуються за іменем методу.
 */
export const PARAMS_KEY = Symbol('mini-nest:params');

/**
 * Головна ідея всього ДЗ у трьох рядках нижче.
 *
 * Параметр-декоратор отримує `(target, propertyKey, parameterIndex)`.
 * `parameterIndex` — це і є позиція аргументу в сигнатурі методу. Тому
 * декоратор нічого не «витягує»: він лише **позначає** — «аргумент №N цього
 * методу треба взяти зі body / з param `name` / з query `name`». Саму мапу
 * `{ index -> {source, name} }` читає вже диспетчер під час виклику і за нею
 * будує масив аргументів у правильному порядку.
 *
 * `target` тут — прототип класу, тож клас дістаємо через `target.constructor`
 * (там само зберігаються маршрути й префікс).
 */
function createParamDecorator(source: ParamSource) {
  return (name?: string): ParameterDecorator => {
    return (target, propertyKey, parameterIndex) => {
      const ctor = (target as { constructor: object }).constructor;
      const methodName = String(propertyKey);

      const byMethod: Record<string, ParamMap> =
        Reflect.getOwnMetadata(PARAMS_KEY, ctor) ?? {};
      const forMethod: ParamMap = byMethod[methodName] ?? {};

      forMethod[parameterIndex] = { source, name };
      byMethod[methodName] = forMethod;

      Reflect.defineMetadata(PARAMS_KEY, byMethod, ctor);
    };
  };
}

/** `@Body()` — увесь розпарсений JSON-об'єкт тіла запиту. */
export const Body = (): ParameterDecorator => createParamDecorator('body')();

/** `@Param(name)` — сегмент маршруту, напр. `:id` у `/users/:id`. */
export const Param = (name: string): ParameterDecorator =>
  createParamDecorator('param')(name);

/** `@Query(name)` — значення query-параметра, напр. `?limit=5`. */
export const Query = (name: string): ParameterDecorator =>
  createParamDecorator('query')(name);

/** Прочитати мапу параметрів конкретного методу контролера. */
export function getParamMap(target: object, methodName: string): ParamMap {
  const byMethod: Record<string, ParamMap> =
    Reflect.getOwnMetadata(PARAMS_KEY, target) ?? {};
  return byMethod[methodName] ?? {};
}
