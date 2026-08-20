import type http from 'node:http';
import type { Container } from '../container';
import type { CompiledRoute } from '../router';

/**
 * Контракти життєвого циклу запиту (Лекція 8). Винесені в окремий модуль, щоб
 * guards / interceptors / pipes / filters залежали від інтерфейсів, а не від
 * важкого `dispatcher.ts` — інакше вийшов би цикл імпортів (диспетчер тягне їх,
 * вони тягнуть диспетчер).
 *
 * Повний цикл, який складає диспетчер:
 *   Middleware → Guard → Interceptor(before) → Pipe → Handler
 *              → Interceptor(after) → Exception Filter
 *
 * Уся різниця між стадіями — у ДВОХ речах: КОЛИ їх викликають і ЩО кожна може
 * повернути. Guard відповідає «пускати чи ні» ДО всього й не бачить результату;
 * interceptor обгортає виклик і бачить і вхід, і вихід; pipe трансформує один
 * аргумент перед обробником; filter ловить будь-яку помилку в самому кінці.
 */

/** Дозволяє обробнику (чи фільтру) явно задати HTTP-статус, не втрачаючи тіло. */
export class HttpResponse<T = unknown> {
  constructor(
    public readonly status: number,
    public readonly body: T,
  ) {}
}

/**
 * Контекст виконання одного запиту — усе, що стадії циклу бачать навколо виклику
 * обробника: сам HTTP-запит/відповідь, знайдений маршрут і його метадані,
 * контейнер (щоб дістати залежності), екземпляр контролера та імʼя методу, а
 * також мутабельний `args` — аргументи, які підуть у метод (pipe складає їх, а
 * interceptor міг би підмінити ДО виклику).
 */
export interface ExecutionContext {
  readonly req: http.IncomingMessage;
  readonly res: http.ServerResponse;
  readonly url: URL;
  readonly route: CompiledRoute;
  readonly pathParams: Record<string, string>;
  readonly container: Container;
  /** Екземпляр контролера з контейнера. */
  readonly controller: Record<string, (...a: unknown[]) => unknown>;
  /** Імʼя методу-обробника на контролері. */
  readonly handlerName: string;
  /** Аргументи для методу (їх складає pipe-стадія); стадія може змінити їх до виклику. */
  args: unknown[];
}

/** Наступна ланка onion-ланцюга: викликає решту й повертає результат обробника. */
export type Next = () => Promise<unknown>;

/**
 * Middleware — найзовнішня ланка (onion-стиль). Викликає `next()` — і те, що
 * поверне, лишає як є, обгортає або підмінює; або **не** викликає `next()` зовсім
 * (тоді нічого глибше не виконається). Guard та interceptor під капотом
 * зводяться до цієї ж форми, тож увесь цикл — один композований ланцюг.
 */
export type Middleware = (ctx: ExecutionContext, next: Next) => Promise<unknown>;

/**
 * Guard: «пускати запит далі чи ні». Виконується ДО обробника й ДО валідації,
 * НЕ бачить результату і не може його змінити. `false` → диспетчер відповість
 * `403`, обробник не викликається зовсім.
 */
export interface CanActivate {
  canActivate(ctx: ExecutionContext): boolean | Promise<boolean>;
}

/**
 * Interceptor: обгортає виклик обробника. Код до `next()`, сам виклик,
 * код після — тому бачить і вхід (ctx), і вихід (результат `next()`), і час
 * навколо. Може трансформувати результат або зловити помилку.
 */
export interface Interceptor {
  intercept(ctx: ExecutionContext, next: Next): Promise<unknown>;
}

/** Метадані аргументу, які pipe отримує разом зі значенням. */
export interface ArgumentMetadata {
  /** Звідки взято аргумент: `body` | `param` | `query`. */
  source: string;
  /** Оголошений тип аргументу (`design:paramtypes`) — напр. клас DTO для `@Body()`. */
  metatype: unknown;
  /** Імʼя ключа для param/query (`id`, `limit`); для body — `undefined`. */
  name?: string;
}

/**
 * Pipe: трансформує/валідує ОДИН аргумент безпосередньо перед передачею в
 * обробник. Повертає нове значення (напр. розпарсений DTO) або кидає помилку
 * (напр. `ValidationError` → `400`).
 */
export interface PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown | Promise<unknown>;
}

/**
 * Exception Filter: останній у циклі. Ловить будь-яку помилку, кинуту з ланцюга
 * (guard/interceptor/pipe/handler), і перетворює її на `HttpResponse`.
 * Повертає `undefined`, якщо цей фільтр цю помилку не обробляє — тоді диспетчер
 * пробує наступний (і врешті — вбудований, що завжди дає відповідь).
 */
export interface ExceptionFilter {
  catch(err: unknown, ctx?: ExecutionContext): HttpResponse | undefined;
}
