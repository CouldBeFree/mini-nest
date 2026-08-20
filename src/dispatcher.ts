import 'reflect-metadata';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Container } from './container';
import { Router, type CompiledRoute } from './router';
import { ZodValidationPipe } from './pipes/zod-validation.pipe';
import { AllExceptionsFilter } from './filters/exception.filter';
import {
  HttpResponse,
  type ArgumentMetadata,
  type CanActivate,
  type ExceptionFilter,
  type ExecutionContext,
  type Interceptor,
  type Middleware,
  type Next,
  type PipeTransform,
} from './http/lifecycle';
import {
  ForbiddenError,
  MalformedJsonError,
  NotFoundError,
  PayloadTooLargeError,
} from './http/exceptions';
import {
  getRequestId,
  resolveRequestId,
  runWithRequestContext,
} from './context/request-context';
import type { Constructor } from './tokens';
import type { ParamMeta } from './decorators/params';

// Реекспорт публічних типів/класів, щоб споживачі імпортували їх зі звичного
// місця (`../dispatcher`), не знаючи про внутрішній розклад по модулях.
export { HttpResponse } from './http/lifecycle';
export type {
  ExecutionContext,
  Middleware,
  Next,
  CanActivate,
  Interceptor,
  PipeTransform,
  ExceptionFilter,
} from './http/lifecycle';
export { PayloadTooLargeError } from './http/exceptions';

/** Стеля розміру тіла за замовчуванням — 1 MiB. */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/**
 * Диспетчер: HTTP-шар поверх `node:http`, що проводить кожен запит крізь повний
 * життєвий цикл Лекції 8:
 *
 *   Middleware → Guard → Interceptor(before) → Pipe → Handler
 *              → Interceptor(after) → Exception Filter
 *
 * Стадії — не «вшиті лінійно», а композований onion-ланцюг (`#runLifecycle`):
 * middleware — найзовнішні, всередині них guard, далі interceptors, а в самому
 * осерді — pipe (складання+валідація аргументів) і виклик обробника. Увесь цикл
 * обгорнуто в один try/catch, останню ланку якого тримає Exception Filter.
 *
 * Кожен запит виконується у власному контексті `AsyncLocalStorage` (requestId),
 * тож будь-який код глибоко в стеку дістає id без передачі параметром, а
 * відповідь несе його в заголовку `X-Request-Id`.
 */
export class Dispatcher {
  readonly #router = new Router();
  /** Вбудований pipe валідації тіла — працює завжди, без реєстрації (регресія ДЗ#7). */
  readonly #bodyPipe = new ZodValidationPipe();
  readonly #defaultFilter = new AllExceptionsFilter();

  readonly #middleware: Middleware[] = [];
  readonly #guards: CanActivate[] = [];
  readonly #interceptors: Interceptor[] = [];
  readonly #pipes: PipeTransform[] = [];
  readonly #filters: ExceptionFilter[] = [];

  /**
   * Контейнер приходить ззовні — той самий, що й у частині 1 (сервіси й
   * контролери як singletons). `maxBodyBytes` — стеля розміру тіла: за
   * перевищенням читання припиняється й повертається `413`.
   */
  constructor(
    private readonly container: Container = new Container(),
    private readonly maxBodyBytes: number = DEFAULT_MAX_BODY_BYTES,
  ) {}

  /** Зареєструвати контролери (їхні маршрути читаються з метаданих). */
  register(...controllers: Constructor[]): this {
    for (const controller of controllers) this.#router.register(controller);
    return this;
  }

  /** Додати middleware — найзовнішні ланки циклу (onion, у порядку реєстрації). */
  use(...middleware: Middleware[]): this {
    this.#middleware.push(...middleware);
    return this;
  }

  /** Додати глобальні guards (виконуються до обробника для всіх маршрутів). */
  useGuards(...guards: CanActivate[]): this {
    this.#guards.push(...guards);
    return this;
  }

  /** Додати глобальні interceptors (обгортають виклик обробника). */
  useInterceptors(...interceptors: Interceptor[]): this {
    this.#interceptors.push(...interceptors);
    return this;
  }

  /** Додати глобальні pipes (трансформують кожен аргумент перед обробником). */
  usePipes(...pipes: PipeTransform[]): this {
    this.#pipes.push(...pipes);
    return this;
  }

  /** Додати exception-фільтри (пробуються перед вбудованим; перший, що вернув відповідь, — виграє). */
  useFilters(...filters: ExceptionFilter[]): this {
    this.#filters.push(...filters);
    return this;
  }

  /** `http.RequestListener` — точка входу кожного HTTP-запиту. */
  readonly handle: http.RequestListener = (req, res) => {
    // Кожен запит — у власному контексті ALS з наскрізним requestId. Обгортаємо
    // ВЕСЬ обробник, тож усе, що з нього породиться (навіть після await), бачить
    // саме цей store.
    const store = { requestId: resolveRequestId(req.headers['x-request-id']) };
    runWithRequestContext(store, () => {
      // #dispatch має власний try/catch (→ Exception Filter). Цей .catch — лише
      // остання сітка безпеки, якщо впав сам шлях обробки помилки.
      this.#dispatch(req, res).catch(() => {
        if (!res.writableEnded) {
          try {
            this.#send(res, 500, { statusCode: 500, message: 'Internal Server Error' });
          } catch {
            /* нічого не вдіємо — з'єднання вже мертве */
          }
        }
      });
    });
  };

  /** Створити (але не запускати) HTTP-сервер поверх диспетчера. */
  createServer(): http.Server {
    return http.createServer(this.handle);
  }

  /** Запустити сервер. Повертає його, коли він уже слухає порт. */
  async listen(port = 0): Promise<http.Server> {
    const server = this.createServer();
    await new Promise<void>((resolve) => server.listen(port, resolve));
    const { port: bound } = server.address() as AddressInfo;
    console.log(`mini-nest слухає http://localhost:${bound}`);
    return server;
  }

  async #dispatch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let ctx: ExecutionContext | undefined;
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const match = this.#router.match(req.method ?? 'GET', url.pathname);
      if (!match) {
        throw new NotFoundError(`Cannot ${req.method} ${url.pathname}`);
      }

      // Контейнер із частини 1 створює контролер і всі його залежності.
      const controller = this.container.resolve(match.route.controller) as Record<
        string,
        (...a: unknown[]) => unknown
      >;

      ctx = {
        req,
        res,
        url,
        route: match.route,
        pathParams: match.pathParams,
        container: this.container,
        controller,
        handlerName: match.route.handlerName,
        args: [],
      };

      const result = await this.#runLifecycle(ctx);

      if (result instanceof HttpResponse) {
        this.#send(res, result.status, result.body);
        return;
      }
      // POST за замовчуванням — 201 Created, решта — 200 OK (як у Nest).
      this.#send(res, match.route.method === 'POST' ? 201 : 200, result);
    } catch (err) {
      // Останній у циклі — Exception Filter: будь-яка помилка (guard/interceptor/
      // pipe/handler/читання тіла) стає HTTP-відповіддю тут.
      this.#handleError(req, res, err, ctx);
    }
  }

  /**
   * Скласти й запустити onion-ланцюг усього циклу.
   *
   * Термінальна ланка — pipe (складання+валідація аргументів) і виклик обробника.
   * Її обгортають, зсередини назовні: interceptors, потім guard-ланка, потім
   * middleware. Тому виконання йде рівно в порядку
   *   middleware → guard → interceptor(before) → pipe → handler → interceptor(after).
   * Guard стоїть ДО pipe навмисно: неавторизований запит відсікаємо, не читаючи
   * й не валідуючи його тіло.
   */
  #runLifecycle(ctx: ExecutionContext): Promise<unknown> {
    const terminal: Next = async () => {
      ctx.args = await this.#buildArgs(ctx); // ← pipe-стадія
      return ctx.controller[ctx.handlerName](...ctx.args); // ← handler
    };

    // Guard-ланка: проганяє всі guards; якщо хтось відмовив — кидає ForbiddenError
    // (→ фільтр → 403) і `next()` не викликає, тож нічого глибше не виконається.
    const guardLink: Middleware = async (c, next) => {
      await this.#runGuards(c);
      return next();
    };

    // Interceptors зводимо до тієї ж форми ланки, що й middleware.
    const interceptorLinks: Middleware[] = this.#interceptors.map(
      (i) => (c, next) => i.intercept(c, next),
    );

    const links: Middleware[] = [...this.#middleware, guardLink, ...interceptorLinks];
    const composed = links.reduceRight<Next>(
      (next, link) => () => link(ctx, next),
      terminal,
    );
    return composed();
  }

  /** Проганяємо глобальні, потім маршрутні guards. `false` → `403`, обробник не буде. */
  async #runGuards(ctx: ExecutionContext): Promise<void> {
    for (const guard of this.#guards) {
      if (!(await guard.canActivate(ctx))) throw new ForbiddenError();
    }
    for (const GuardClass of ctx.route.guards) {
      const guard = this.container.resolve(GuardClass);
      if (!(await guard.canActivate(ctx))) throw new ForbiddenError();
    }
  }

  /**
   * Pipe-стадія: за мапою параметр-декораторів дістаємо кожне значення на його
   * позицію, проганяємо @Body через вбудований Zod-pipe, а потім кожен аргумент —
   * через глобальні pipes. Тіло читаємо саме тут (а не раніше), тож guard устигає
   * відсікти запит до читання/валідації.
   */
  async #buildArgs(ctx: ExecutionContext): Promise<unknown[]> {
    const { route, url, pathParams, req } = ctx;
    const rawBody = this.#needsBody(route) ? await this.#readJson(req) : undefined;

    const count = Math.max(
      route.paramTypes.length,
      ...Object.keys(route.params).map((i) => Number(i) + 1),
      0,
    );

    const args: unknown[] = new Array(count).fill(undefined);
    for (let i = 0; i < count; i++) {
      const meta: ParamMeta | undefined = route.params[i];
      if (!meta) continue;

      const metadata: ArgumentMetadata = {
        source: meta.source,
        metatype: route.paramTypes[i],
        name: meta.name,
      };

      let value = this.#extract(meta, url, pathParams, rawBody);
      // @Body() спершу через вбудований pipe валідації (валідне → екземпляр DTO).
      if (meta.source === 'body') {
        value = await this.#bodyPipe.transform(value, metadata);
      }
      // Далі — глобальні pipes (застосовуються до кожного аргументу).
      for (const pipe of this.#pipes) {
        value = await pipe.transform(value, metadata);
      }
      args[i] = value;
    }
    return args;
  }

  /** Дістати сире значення аргументу за описом параметр-декоратора. */
  #extract(
    meta: ParamMeta,
    url: URL,
    pathParams: Record<string, string>,
    rawBody: unknown,
  ): unknown {
    switch (meta.source) {
      case 'param':
        return pathParams[meta.name as string];
      case 'query':
        return url.searchParams.get(meta.name as string) ?? undefined;
      case 'body':
        return rawBody ?? {};
    }
  }

  /** Чи має цей маршрут хоч один параметр із джерелом `body`. */
  #needsBody(route: CompiledRoute): boolean {
    return Object.values(route.params).some((p) => p.source === 'body');
  }

  /**
   * Зібрати чанки тіла й розпарсити JSON. Порожнє тіло → `{}`.
   *
   * Рахуємо накопичені байти й на перевищенні `maxBodyBytes` зупиняємо потік і
   * кидаємо `PayloadTooLargeError` — інакше великий (чи нескінченний) POST роздув
   * би памʼять. Сокет НЕ рвемо тут (413-відповідь не встигла б піти) — обрив
   * робить `#handleError` уже ПІСЛЯ відправлення відповіді.
   */
  #readJson(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let done = false; // щоб не обробляти 'end' після аварійної зупинки

      req.on('data', (chunk: Buffer) => {
        if (done) return;
        size += chunk.length;
        if (size > this.maxBodyBytes) {
          done = true;
          req.pause(); // припиняємо буферити, але НЕ рвемо сокет (див. коментар вище)
          reject(new PayloadTooLargeError(this.maxBodyBytes));
          return;
        }
        chunks.push(chunk);
      });

      req.on('error', (err) => {
        if (!done) reject(err);
      });

      req.on('end', () => {
        if (done) return;
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (raw === '') return resolve({});
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new MalformedJsonError());
        }
      });
    });
  }

  /**
   * Прогнати помилку крізь фільтри (спершу зареєстровані, тоді вбудований, що
   * завжди дає відповідь) і відправити результат. Для `413` після відповіді
   * рвемо сокет, щоб клієнт не тримав недочитане завантаження.
   */
  #handleError(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    err: unknown,
    ctx?: ExecutionContext,
  ): void {
    if (res.writableEnded) return;
    for (const filter of [...this.#filters, this.#defaultFilter]) {
      const response = filter.catch(err, ctx);
      if (response) {
        this.#send(res, response.status, response.body);
        if (err instanceof PayloadTooLargeError) req.destroy();
        return;
      }
    }
  }

  /** Єдина точка серіалізації відповіді в JSON. Сюди ж чіпляємо `X-Request-Id`. */
  #send(res: http.ServerResponse, status: number, body: unknown): void {
    const headers: http.OutgoingHttpHeaders = {
      'Content-Type': 'application/json; charset=utf-8',
    };
    // Той самий id, що й у решти коду цього запиту — беремо зі сховища ALS.
    const requestId = getRequestId();
    if (requestId) headers['X-Request-Id'] = requestId;

    res.writeHead(status, headers);
    res.end(body === undefined ? '' : JSON.stringify(body));
  }
}
