import 'reflect-metadata';
import type { Token } from '../tokens';

/** Ключ метаданих: мапа parameterIndex -> token. */
export const INJECT_TOKENS_KEY = Symbol('mini-nest:inject-tokens');

export type InjectTokenMap = Record<number, Token>;

/**
 * Параметр-декоратор для явного токена залежності.
 *
 * Потрібен там, де типу з `design:paramtypes` недостатньо: інтерфейси при
 * компіляції стираються до `Object`, тому контейнер не може за ними нічого
 * знайти. @Inject(token) каже: «для цього параметра бери залежність не за
 * типом, а за ось цим токеном».
 *
 * Декоратор конструктора викликається з target = сам клас, propertyKey = undefined
 * і індексом параметра. Ми накопичуємо мапу індекс -> токен на класі.
 */
export function Inject(token: Token): ParameterDecorator {
  return (target, _propertyKey, parameterIndex) => {
    const existing: InjectTokenMap =
      Reflect.getOwnMetadata(INJECT_TOKENS_KEY, target) ?? {};
    existing[parameterIndex] = token;
    Reflect.defineMetadata(INJECT_TOKENS_KEY, existing, target);
  };
}
