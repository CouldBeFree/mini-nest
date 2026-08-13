import 'reflect-metadata';
import { INJECTABLE_KEY, SCOPE_KEY, type Scope } from './decorators/injectable';
import { INJECT_TOKENS_KEY, type InjectTokenMap } from './decorators/inject';
import type { Constructor, Token } from './tokens';

/** Способи зареєструвати залежність під токеном. */
export type Provider<T = unknown> =
  | Constructor<T> //            прив'язати токен до конкретного класу
  | { useClass: Constructor<T> } // те саме, але явно
  | { useValue: T }; //          віддати готове значення (конфіг, рядок, обʼєкт)

/** Помилка циклу: несе весь ланцюг залежностей, а не тільки факт падіння. */
export class CircularDependencyError extends Error {
  constructor(public readonly chain: string) {
    super(`Circular dependency detected: ${chain}`);
    this.name = 'CircularDependencyError';
  }
}

export class Container {
  readonly #providers = new Map<Token, Provider>();
  readonly #singletons = new Map<Token, unknown>();

  /** Прив'язати токен до провайдера (клас або готове значення). */
  register<T>(token: Token<T>, provider: Provider<T>): this {
    this.#providers.set(token, provider as Provider);
    return this;
  }

  /** Створити (або дістати з кешу) екземпляр за токеном. */
  resolve<T>(token: Token<T>): T {
    // path — впорядкована множина класів, які ми зараз конструюємо. Її ми
    // передаємо в рекурсію, щоб ловити цикли.
    return this.#resolve(token, new Set<Token>()) as T;
  }

  #resolve(token: Token, path: Set<Token>): unknown {
    const provider = this.#providers.get(token);

    // 1. Готове значення (useValue) — віддаємо як є, це фактично синглтон.
    if (provider && typeof provider === 'object' && 'useValue' in provider) {
      return provider.useValue;
    }

    // 2. Уже створений синглтон під цим токеном.
    if (this.#singletons.has(token)) {
      return this.#singletons.get(token);
    }

    // 3. Визначаємо конкретний клас, який треба сконструювати.
    const target = this.#resolveClass(token, provider);

    // 4. Клас має бути позначений @Injectable() — інакше в нього не буде
    //    design:paramtypes і взагалі контейнеру нема чого будувати.
    if (!Reflect.getMetadata(INJECTABLE_KEY, target)) {
      throw new Error(
        `Cannot resolve "${target.name}": class is not decorated with @Injectable().`,
      );
    }

    // 5. Детекція циклу — ПЕРШ НІЖ заходити в конструктор.
    if (path.has(target)) {
      const chain = [...path, target].map(tokenName).join(' -> ');
      throw new CircularDependencyError(chain);
    }

    // 6. Рекурсивно резолвимо аргументи конструктора.
    const nextPath = new Set(path).add(target);
    const paramTypes: unknown[] =
      Reflect.getMetadata('design:paramtypes', target) ?? [];
    const injectTokens: InjectTokenMap =
      Reflect.getMetadata(INJECT_TOKENS_KEY, target) ?? {};

    const args = paramTypes.map((paramType, index) => {
      // Явний @Inject(token) має пріоритет над типом із метаданих.
      const depToken = (injectTokens[index] ?? paramType) as Token;
      return this.#resolve(depToken, nextPath);
    });

    const instance = new (target as Constructor)(...args);

    // 7. Кешуємо, якщо скоуп singleton; для transient — щоразу новий екземпляр.
    const scope: Scope = Reflect.getMetadata(SCOPE_KEY, target) ?? 'singleton';
    if (scope === 'singleton') {
      this.#singletons.set(token, instance);
    }
    return instance;
  }

  /** З токена + провайдера дістаємо конкретний клас-конструктор. */
  #resolveClass(token: Token, provider: Provider | undefined): Constructor {
    if (provider) {
      if (typeof provider === 'object' && 'useClass' in provider) {
        return provider.useClass;
      }
      if (typeof provider === 'function') {
        return provider;
      }
    }
    // Немає провайдера, але токен — це сам клас: self-binding.
    if (typeof token === 'function') {
      return token;
    }
    throw new Error(
      `No provider registered for token "${tokenName(token)}". ` +
        `Register it: container.register(token, { useClass } | { useValue }).`,
    );
  }
}

/** Людиночитна назва токена для повідомлень про помилки. */
function tokenName(token: Token): string {
  if (typeof token === 'function') return token.name;
  if (typeof token === 'symbol') return token.description ?? token.toString();
  return String(token);
}
