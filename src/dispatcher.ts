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

/**
 * Диспетчер: HTTP-шар поверх `node:http`.
 *
 * Життєвий цикл запиту:
 *   1) розібрати URL (шлях + query);
 *   2) знайти маршрут у роутері (`404`, якщо збігу немає);
 *   3) за потреби зчитати й розпарсити JSON-тіло (`400` на битий JSON);
 *   4) зібрати масив аргументів за мапою параметр-декораторів
 *      (@Body проходить через ValidationPipe → `400` на невалідне тіло);
 *   5) дістати екземпляр контролера з контейнера (частина 1) і викликати метод;
 *   6) серіалізувати результат у JSON.
 */
export class Dispatcher {
  readonly #router = new Router();
  readonly #pipe = new ValidationPipe();

  /**
   * Контейнер приходить ззовні — той самий, що й у частині 1. Завдяки цьому
   * контролери й сервіси живуть як singletons: сервіс, який дістане тест, — той
   * самий екземпляр, що інжектнутий у контролер.
   */
  constructor(private readonly container: Container = new Container()) {}

  /** Зареєструвати контролери (їхні маршрути читаються з метаданих). */
  register(...controllers: Constructor[]): this {
    for (const controller of controllers) this.#router.register(controller);
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
      throw err; // інше — у 500-обгортку в handle()
    }

    // Контейнер із частини 1 створює контролер і всі його залежності.
    const controller = this.container.resolve(match.route.controller) as Record<
      string,
      (...a: unknown[]) => unknown
    >;
    const result = await controller[match.route.handlerName](...args);

    if (result instanceof HttpResponse) {
      this.#send(res, result.status, result.body);
      return;
    }
    // POST за замовчуванням — 201 Created, решта — 200 OK (як у Nest).
    this.#send(res, match.route.method === 'POST' ? 201 : 200, result);
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

  /** Зібрати чанки тіла й розпарсити JSON. Порожнє тіло → `{}`. */
  #readJson(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('error', reject);
      req.on('end', () => {
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
