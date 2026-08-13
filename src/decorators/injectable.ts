import 'reflect-metadata';

export type Scope = 'singleton' | 'transient';

export interface InjectableOptions {
  /**
   * singleton (за замовчуванням) — один екземпляр на контейнер.
   * transient — новий екземпляр на кожен resolve.
   */
  scope?: Scope;
}

/** Ключі метаданих, які потім читає контейнер. */
export const INJECTABLE_KEY = Symbol('mini-nest:injectable');
export const SCOPE_KEY = Symbol('mini-nest:scope');

/**
 * Позначає клас як придатний до створення контейнером.
 *
 * Уся «магія» Nest тут — це рівно два `Reflect.defineMetadata`:
 *   1) прапорець «цей клас можна інжектити»;
 *   2) його скоуп.
 *
 * А головний побічний ефект — сам факт наявності декоратора: тільки тоді
 * TypeScript (за увімкненого emitDecoratorMetadata) запише в метадані
 * `design:paramtypes` — типи параметрів конструктора, з яких контейнер і
 * будує граф залежностей.
 */
export function Injectable(options: InjectableOptions = {}): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(INJECTABLE_KEY, true, target);
    Reflect.defineMetadata(SCOPE_KEY, options.scope ?? 'singleton', target);
  };
}
