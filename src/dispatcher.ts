import 'reflect-metadata';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Container } from './container';
import { Router, type CompiledRoute, type RouteMatch } from './router';
import { ValidationPipe, ValidationError } from './pipes/validation.pipe';
import type { Constructor } from './tokens';
import type { ParamMeta } from './decorators/params';

/** Дозволяє обробнику самому задати HTTP-статус, не втрачаючи тіло-обʼєкт. */
export class HttpResponse<T = unknown> {
  constructor(
    public readonly status: number,
    public readonly body: T,
  ) {}
}

/** Тіло запиту перевищило ліміт байтів — диспетчер відповість `413`. */
export class PayloadTooLargeError extends Error {
  constructor(public readonly limit: number) {
    super(`Request body exceeds limit of ${limit} bytes`);
    this.name = 'PayloadTooLargeError';
  }
}

/** Стеля розміру тіла за замовчуванням — 1 MiB. */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/**
 * Контекст виконання одного запиту — усе, що ланки ланцюжка бачать навколо
 * виклику обробника. Саме сюди ДЗ#8 (guards / interceptors) дивитиметься, щоб
 * вирішити «пускати далі?» чи «як трансформувати результат»: маршрут і його
 * метадані є в `route`, залежності — через `container`, аргументи методу —
 * у мутабельному `args` (інтерсептор може їх підмінити ДО виклику).
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
  /** Аргументи для методу (після пайпів); ланка може змінити їх до `next()`. */
  args: unknown[];
}

/** Наступна ланка: викликає решту ланцюжка й повертає результат обробника. */
export type Next = () => Promise<unknown>;

/**
 * Ланка навколо виклику обробника (onion-стиль, як у Nest interceptors).
 * Викликає `next()` — і те, що поверне, може лишити як є, обгорнути або
 * підмінити; або **не** викликати `next()` зовсім — тоді обробник не
 * запуститься (так поводиться guard, що відхиляє запит).
 */
export type Middleware = (ctx: ExecutionContext, next: Next) => Promise<unknown>;

/**
 * Диспетчер: HTTP-шар поверх `node:http`.
 *
 * Життєвий цикл запиту:
 *   1) розібрати URL (шлях + query);
 *   2) знайти маршрут у роутері (`404`, якщо збігу немає);
 *   3) за потреби зчитати й розпарсити JSON-тіло (`400` на битий JSON,
 *      `413`, якщо тіло перевищує ліміт байтів);
 *   4) зібрати масив аргументів за мапою параметр-декораторів
 *      (@Body проходить через ValidationPipe → `400` на невалідне тіло);
 *   5) дістати екземпляр контролера з контейнера (частина 1) і викликати метод
 *      через ланцюжок ланок (`#runChain`) — точка розширення для ДЗ#8
 *      (guards / interceptors); без зареєстрованих ланок це просто виклик методу;
 *   6) серіалізувати результат у JSON.
 */
export class Dispatcher {
  readonly #router = new Router();
  readonly #pipe = new ValidationPipe();
  /**
   * Ланки навколо виклику обробника. Порожній список = виклик «як є» (поточна
   * поведінка). ДЗ#8 додаватиме сюди guards/interceptors через `use(...)`,
   * не чіпаючи `#dispatch`.
   */
  readonly #chain: Middleware[] = [];

  /**
   * Контейнер приходить ззовні — той самий, що й у частині 1. Завдяки цьому
   * контролери й сервіси живуть як singletons: сервіс, який дістане тест, — той
   * самий екземпляр, що інжектнутий у контролер.
   *
   * `maxBodyBytes` — стеля розміру тіла запиту; за перевищенням читання
   * припиняється й повертається `413` (див. `#readJson`).
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

  /**
   * Додати ланки навколо виклику обробника (у порядку реєстрації — зовнішні
   * першими). Це точка розширення для ДЗ#8: guards, interceptors, filters
   * підключаються сюди, а `#dispatch` лишається незмінним.
   */
  use(...middleware: Middleware[]): this {
    this.#chain.push(...middleware);
    return this;
  }

  /** `http.RequestListener` — сюди приходить кожен HTTP-запит. */
  readonly handle: http.RequestListener = (req, res) => {
    // Не даємо жодному винятку «прорватись» повз відповідь.
    this.#dispatch(req, res).catch((err) => {
      this.#send(res, 500, {
        statusCode: 500,
        message: err instanceof Error ? err.message : 'Internal Server Error',
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
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = this.#router.match(req.method ?? 'GET', url.pathname);

    if (!match) {
      this.#send(res, 404, {
        statusCode: 404,
        message: `Cannot ${req.method} ${url.pathname}`,
      });
      return;
    }

    let args: unknown[];
    try {
      // Сире тіло читаємо лише коли метод справді очікує @Body().
      const rawBody = this.#needsBody(match.route)
        ? await this.#readJson(req)
        : undefined;
      args = await this.#buildArgs(match, url, rawBody);
    } catch (err) {
      if (err instanceof ValidationError) {
        this.#send(res, 400, {
          statusCode: 400,
          message: 'Validation failed',
          errors: err.errors,
        });
        return;
      }
      if (err instanceof SyntaxError) {
        this.#send(res, 400, { statusCode: 400, message: err.message });
        return;
      }
      if (err instanceof PayloadTooLargeError) {
        this.#send(res, 413, { statusCode: 413, message: err.message });
        // Відповідь пішла — тепер обриваємо недочитане завантаження, щоб клієнт,
        // який ще шле тіло, не тримав зʼєднання відкритим.
        req.destroy();
        return;
      }
      throw err; // інше — у 500-обгортку в handle()
    }

    // Контейнер із частини 1 створює контролер і всі його залежності.
    const controller = this.container.resolve(match.route.controller) as Record<
      string,
      (...a: unknown[]) => unknown
    >;

    // Виклик обробника йде через ланцюжок: без ланок — це просто виклик методу,
    // із ланками (ДЗ#8) — guards/interceptors навколо нього.
    const ctx: ExecutionContext = {
      req,
      res,
      url,
      route: match.route,
      pathParams: match.pathParams,
      container: this.container,
      controller,
      handlerName: match.route.handlerName,
      args,
    };
    const result = await this.#runChain(ctx);

    if (result instanceof HttpResponse) {
      this.#send(res, result.status, result.body);
      return;
    }
    // POST за замовчуванням — 201 Created, решта — 200 OK (як у Nest).
    this.#send(res, match.route.method === 'POST' ? 201 : 200, result);
  }

  /**
   * Скласти onion-ланцюжок навколо виклику обробника й запустити його.
   *
   * Термінальна ланка — власне виклик методу контролера. `reduceRight`
   * обгортає її ланками у зворотному порядку, тож зовнішня ланка бачить `next`,
   * який веде до наступної і врешті — до самого обробника. Порожній `#chain`
   * дає рівно `terminal()` — тобто поведінку «виклик як є», без накладних.
   */
  #runChain(ctx: ExecutionContext): Promise<unknown> {
    const terminal: Next = () =>
      Promise.resolve(ctx.controller[ctx.handlerName](...ctx.args));

    const composed = this.#chain.reduceRight<Next>(
      (next, middleware) => () => middleware(ctx, next),
      terminal,
    );
    return composed();
  }

  /** Чи має цей маршрут хоч один параметр із джерелом `body`. */
  #needsBody(route: CompiledRoute): boolean {
    return Object.values(route.params).some((p) => p.source === 'body');
  }

  /**
   * Побудова масиву аргументів за мапою параметрів. Ключ мапи — індекс
   * аргументу, тож ми кладемо кожне значення рівно на його позицію.
   */
  async #buildArgs(
    match: RouteMatch,
    url: URL,
    rawBody: unknown,
  ): Promise<unknown[]> {
    const { route, pathParams } = match;
    const count = Math.max(
      route.paramTypes.length,
      ...Object.keys(route.params).map((i) => Number(i) + 1),
      0,
    );

    const args: unknown[] = new Array(count).fill(undefined);
    for (let i = 0; i < count; i++) {
      const meta: ParamMeta | undefined = route.params[i];
      if (!meta) continue;
      args[i] = await this.#extract(meta, url, pathParams, rawBody, route.paramTypes[i]);
    }
    return args;
  }

  /** Дістати одне значення за описом параметр-декоратора. */
  async #extract(
    meta: ParamMeta,
    url: URL,
    pathParams: Record<string, string>,
    rawBody: unknown,
    metatype: unknown,
  ): Promise<unknown> {
    switch (meta.source) {
      case 'param':
        return pathParams[meta.name as string];
      case 'query':
        return url.searchParams.get(meta.name as string) ?? undefined;
      case 'body':
        // @Body() проходить через ValidationPipe: валідне → екземпляр DTO.
        return this.#pipe.transform(rawBody ?? {}, metatype as Constructor);
    }
  }

  /**
   * Зібрати чанки тіла й розпарсити JSON. Порожнє тіло → `{}`.
   *
   * Рахуємо накопичені байти й на перевищенні `maxBodyBytes` зупиняємо потік і
   * кидаємо `PayloadTooLargeError` — інакше достатньо великий (чи нескінченний)
   * POST роздув би памʼять процесу. Сокет НЕ рвемо тут (413-відповідь не встигла
   * б піти) — обрив робить обробник помилок у #dispatch після відповіді.
   */
  #readJson(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let done = false; // щоб не обробляти 'end' після аварійного розриву

      req.on('data', (chunk: Buffer) => {
        if (done) return;
        size += chunk.length;
        if (size > this.maxBodyBytes) {
          done = true;
          // Зупиняємо потік (більше нічого не буферимо), але НЕ рвемо сокет —
          // інакше 413-відповідь не встигне піти. Обрив зробить обробник помилок
          // у #dispatch уже ПІСЛЯ того, як відповідь відправлено.
          req.pause();
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
          reject(new SyntaxError('Malformed JSON in request body'));
        }
      });
    });
  }

  /** Єдина точка серіалізації відповіді у JSON. */
  #send(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  }
}
