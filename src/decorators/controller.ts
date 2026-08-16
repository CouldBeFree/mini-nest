import 'reflect-metadata';
import { INJECTABLE_KEY, SCOPE_KEY } from './injectable';

/** Ключ метаданих: базовий шлях (префікс) контролера. */
export const CONTROLLER_PREFIX_KEY = Symbol('mini-nest:controller-prefix');

/**
 * Декоратор класу-контролера.
 *
 * Робить рівно дві речі:
 *   1) записує базовий шлях у метадані — звідси диспетчер потім складе повний
 *      маршрут (`префікс + шлях методу`);
 *   2) позначає клас як `@Injectable` — контролеру потрібні сервіси через
 *      конструктор, а їх підставляє контейнер із частини 1. Тому контролер
 *      мусить бути резолвним так само, як звичайний провайдер. У Nest це саме
 *      так і працює: `@Controller` неявно вмикає інжекцію.
 *
 * Наявність декоратора також змушує tsc (за `emitDecoratorMetadata`) записати
 * `design:paramtypes` конструктора — без цього контейнер не побачив би
 * залежностей контролера.
 */
export function Controller(prefix = ''): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(CONTROLLER_PREFIX_KEY, normalizePrefix(prefix), target);
    // Контролер — теж провайдер: даємо контейнеру право його створювати.
    Reflect.defineMetadata(INJECTABLE_KEY, true, target);
    Reflect.defineMetadata(SCOPE_KEY, 'singleton', target);
  };
}

/** Чи є цей клас контролером (має записаний префікс). */
export function isController(target: unknown): boolean {
  return typeof target === 'function' && Reflect.hasMetadata(CONTROLLER_PREFIX_KEY, target);
}

/** Прочитати префікс контролера (порожній рядок, якщо його немає). */
export function getControllerPrefix(target: object): string {
  return Reflect.getMetadata(CONTROLLER_PREFIX_KEY, target) ?? '';
}

/**
 * Зводимо префікс до канонічного вигляду: провідний `/`, без хвостового.
 * `'users'` → `'/users'`, `'/users/'` → `'/users'`, `''`/`'/'` → `''`.
 * Порожній префікс означає «монтувати в корінь».
 */
function normalizePrefix(prefix: string): string {
  const trimmed = prefix.trim().replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? '' : `/${trimmed}`;
}
