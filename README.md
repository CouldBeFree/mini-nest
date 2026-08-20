# mini-nest

Мінімальний фреймворк у стилі NestJS, зібраний з нуля поверх `node:http`, без
`@nestjs/*`, `express` чи `fastify`.

- **Частина 1** — IoC-контейнер: читає типи конструктора з метаданих і сам збирає
  граф залежностей.
- **Частина 2** — HTTP: маршрутизація на декораторах і валідація вхідних даних.
- **Частина 3** — повний життєвий цикл запиту: middleware → guard → interceptor →
  pipe → handler → interceptor → exception filter, плюс наскрізний `requestId`
  через `AsyncLocalStorage`.

## Життєвий цикл запиту (частина 3)

Кожен HTTP-виклик проходить ті самі стадії, що й у NestJS. Уся різниця між ними —
у **двох речах**: коли стадію викликають і що вона може повернути.

```
        ┌──────────────────────── request ────────────────────────┐
        │                                                          │
        ▼                                                          │
   ┌─────────────┐   requestId у AsyncLocalStorage на весь запит   │
   │  MIDDLEWARE │   (генерується або береться з X-Request-Id)     │
   └─────┬───────┘                                                 │
         ▼                                                         │
   ┌─────────────┐   «пускати чи ні?» ДО всього. false → 403,      │
   │    GUARD    │   обробник не викликається зовсім.              │
   └─────┬───────┘                                                 │
         ▼                                                         │
   ┌─────────────┐   код ДО виклику: засікає час, готує контекст   │
   │ INTERCEPTOR │ ─────────────┐                                  │
   │  (before)   │              │                                  │
   └─────────────┘              ▼                                  │
                          ┌───────────┐  трансформує/валідує один  │
                          │   PIPE    │  аргумент (Zod) перед       │
                          │  (Zod)    │  передачею в обробник       │
                          └─────┬─────┘                            │
                                ▼                                  │
                          ┌───────────┐                            │
                          │  HANDLER  │  метод контролера           │
                          └─────┬─────┘                            │
   ┌─────────────┐              │                                  │
   │ INTERCEPTOR │ ◀────────────┘                                  │
   │  (after)    │   код ПІСЛЯ: рахує тривалість, може обгорнути   │
   └─────┬───────┘   результат                                     │
         ▼                                                         │
   ┌──────────────────┐  ловить БУДЬ-ЯКУ помилку з ланцюга й       │
   │ EXCEPTION FILTER │  мапить у HTTP: NotFound→404, Validation→  │
   └─────┬────────────┘  400, інше→500 (без стек-трейсу назовні)   │
         ▼                                                         │
         └──────── response (+ заголовок X-Request-Id) ────────────┘
```

- **Guard** відповідає «пускати чи ні» *до* валідації й не бачить результату.
- **Interceptor** обгортає виклик — бачить і вхід, і вихід, і час навколо.
- **Pipe** трансформує *один аргумент* перед обробником (у нас — валідація на Zod).
- **Exception Filter** — остання ланка: єдине місце, де помилка стає HTTP-статусом.

Порядок зафіксовано тестом `test/lifecycle-order.test.ts` — не «щось викликалось»,
а точна послідовність шести міток.

## Чому `AsyncLocalStorage`, а не глобальна змінна

`requestId` треба дістати будь-де в стеку — у сервісі, репозиторії, логері — не
проносячи його параметром крізь кожен виклик. Спокуса — покласти id у модульну
(глобальну) змінну й читати звідти. Це **ламається під конкурентністю**.

Node однопотоковий і кооперативний: поки один запит чекає на `await` (звернення
до БД, таймер, читання тіла), event loop **не простоює** — він бере наступний
запит і виконує його код. Той перезаписує глобальну змінну своїм id. Коли перший
запит прокидається після `await` і читає глобал — там уже **чужий** id. Логи й
відповіді змішуються (та сама пастка, що на Лекції 2). Один тест на 10 паралельних
запитів ловить це миттєво.

`AsyncLocalStorage` вирішує саме це: `als.run(store, cb)` створює сховище, привʼязане
до конкретної асинхронної «гілки» виконання. Усе, що породжується зсередини `cb` —
навіть після `await` — бачить **свій** `store`, а не сусідній. Тому диспетчер
обгортає `als.run` навколо **всього** обробника запиту (інакше глибокі виклики
сховища не побачать), а `getRequestId()` глибоко в стеку завжди повертає id саме
цього запиту. Той самий id повертається клієнту в заголовку `X-Request-Id`.

## Можливості

**Контейнер (частина 1)**

- `@Injectable({ scope? })`; резолв за `design:paramtypes`, рекурсивно.
- `@Inject(token)`; скоупи `singleton` / `transient`; детекція циклів.

**HTTP-шар (частина 2)**

- `@Controller(prefix)`, `@Get`/`@Post`, `@Body`/`@Param`/`@Query`.
- Диспетчер поверх `node:http`; матчинг маршрутів за специфічністю (літерал > `:param`).
- Ліміт розміру тіла з `413`; коректні `400` на битий JSON.

**Життєвий цикл (частина 3)**

- `@UseGuards(...)` + глобальні `useGuards(...)`; `AuthGuard` за `Authorization`.
- Глобальні `useInterceptors(...)`; `LoggingInterceptor` міряє тривалість.
- Валідація як **pipe** на **Zod 4** (`ZodValidationPipe`).
- `AllExceptionsFilter` — доменні помилки → HTTP; жодного стеку назовні.
- `AsyncLocalStorage`: наскрізний `requestId` + заголовок `X-Request-Id`.

## Як запустити

```bash
npm install
npm test        # tsc + node --test; 39 passed, exit 0
npm start       # HTTP-сервер на http://localhost:3000

npm run dev        # nodemon: перезбирає (tsc) і перезапускає сервер на кожну зміну .ts
npm run test:watch # nodemon: перезапускає тести на кожну зміну в src/ або test/
```

> Чому саме перезбірка, а не запуск `.ts` напряму: декоратори потребують компіляції
> через `tsc` (нативний type-stripping Node не емітить `design:paramtypes`), тому
> dev-режим на кожну зміну робить `tsc && node dist/…`, а не запускає джерело як є.

Приклади запитів (сервер має бути піднятий через `npm start`):

```bash
curl -si localhost:3000/users/1 | grep -i x-request-id   # наскрізний id у відповіді
curl -si -H 'X-Request-Id: trace-42' localhost:3000/users/1 | grep -i x-request-id  # свій id повертається

curl "localhost:3000/users?limit=1"                      # @Query('limit')

# захищений маршрут: без Authorization → 403, з Bearer-токеном → 200
curl -i localhost:3000/protected
curl -i -H 'Authorization: Bearer secret' localhost:3000/protected

# @Body + валідація на Zod: невалідне тіло → 400 зі списком полів
curl -X POST localhost:3000/users -H 'content-type: application/json' \
     -d '{"email":"not-an-email","name":"x"}'
# {"statusCode":400,"message":"Validation failed",
#  "errors":[{"field":"email","constraints":["Invalid email address"]}, ...]}
```

У Docker (перевикористовуючи сервіс `api`):

```bash
docker compose run --rm --build api npm test   # 39 passed, exit 0
```

## Структура

| Файл | Призначення |
| --- | --- |
| `src/container.ts` | контейнер: резолв, скоупи, цикли (частина 1) |
| `src/decorators/injectable.ts` · `inject.ts` | `@Injectable()` · `@Inject(token)` (ч.1) |
| `src/decorators/controller.ts` · `methods.ts` · `params.ts` | `@Controller` · `@Get`/`@Post` · `@Body`/`@Param`/`@Query` |
| `src/decorators/use-guards.ts` | `@UseGuards(...)` — guard(и) на контролер/метод |
| `src/router.ts` | збір маршрутів із метаданих + матчинг за специфічністю |
| `src/dispatcher.ts` | HTTP-шар: складає й проганяє весь життєвий цикл |
| `src/http/lifecycle.ts` | контракти стадій: `CanActivate`, `Interceptor`, `PipeTransform`, `ExceptionFilter`, `ExecutionContext` |
| `src/http/exceptions.ts` | ієрархія помилок зі своїм HTTP-статусом |
| `src/guards/auth.guard.ts` | `AuthGuard` — перевірка `Authorization` |
| `src/interceptors/logging.interceptor.ts` | `LoggingInterceptor` — вимірювання тривалості |
| `src/pipes/zod-validation.pipe.ts` | валідація на Zod 4 |
| `src/filters/exception.filter.ts` | мапінг помилок у HTTP |
| `src/context/request-context.ts` | обгортка над `AsyncLocalStorage` (requestId) |
| `src/services/request-log.service.ts` | лог із прив'язкою до запиту (читає id зі сховища) |
| `src/dto/create-user.dto.ts` | DTO + Zod-схема |
| `src/users/*.ts` · `src/protected/*.ts` | демо-контролери й сервіс |
| `src/app.ts` · `src/index.ts` | складання застосунку · точка входу |
| `test/lifecycle-order.test.ts` | точний порядок шести стадій |
| `test/lifecycle.test.ts` · `test/request-context.test.ts` | guard/interceptor/pipe/filter · ALS |

## Обмеження реалізації

- Свій контейнер, маршрутизація й цикл — без сторонніх фреймворків (`@nestjs/*`,
  `express`, `fastify`, `inversify`, `tsyringe`).
- Дозволені бібліотеки: `reflect-metadata`, `zod@4`, `node:async_hooks`, тест-раннер.
- TypeScript 6.x; `experimentalDecorators` + `emitDecoratorMetadata`.
- Тести ганяються по **скомпільованому** коду (`tsc` → `node --test dist/`), бо
  нативний type-stripping Node не емітить `design:paramtypes` — потрібен справжній `tsc`.
