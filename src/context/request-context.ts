import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Усе, що ми хочемо «протягнути» крізь весь стек одного запиту, не передаючи
 * параметром. Поки що — лише `requestId`, але сюди ж лягли б user/tenant/locale.
 */
export interface RequestStore {
  /** Наскрізний ідентифікатор запиту (кореляційний id). */
  requestId: string;
}

/**
 * Одне сховище на процес. `AsyncLocalStorage` тримає окреме значення для кожної
 * асинхронної «гілки» виконання: код усередині `als.run(store, cb)` — і будь-яка
 * асинхронщина, породжена з нього (навіть після `await`) — бачить саме свій
 * `store`. Це і є ключова відмінність від глобальної змінної (див. README).
 */
const als = new AsyncLocalStorage<RequestStore>();

/**
 * Запустити `callback` у контексті запиту. Усе, що виконається синхронно
 * всередині, і всі проміси/таймери/`await`-продовження, породжені звідти,
 * ділитимуть один `store`. Обгортати треба **весь** обробник запиту — інакше
 * глибокі виклики (сервіс, репозиторій, логер) сховища не побачать.
 */
export function runWithRequestContext<T>(store: RequestStore, callback: () => T): T {
  return als.run(store, callback);
}

/**
 * Прочитати весь контекст поточного запиту. `undefined`, якщо код виконується
 * поза `runWithRequestContext` (напр. під час старту застосунку).
 */
export function getRequestContext(): RequestStore | undefined {
  return als.getStore();
}

/**
 * Дістати `requestId` поточного запиту — саме це кличе код глибоко в стеку.
 * Жодного параметра проносити не треба: значення бере з асинхронного сховища.
 */
export function getRequestId(): string | undefined {
  return als.getStore()?.requestId;
}

/**
 * Визначити id для вхідного запиту: якщо клієнт прислав `X-Request-Id` —
 * поважаємо його (наскрізна трасування через кілька сервісів), інакше генеруємо
 * новий UUID. Порожній/масивний заголовок ігноруємо.
 */
export function resolveRequestId(header: string | string[] | undefined): string {
  if (typeof header === 'string' && header.trim() !== '') return header.trim();
  return randomUUID();
}
