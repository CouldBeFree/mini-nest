# mini-nest

Мінімальний фреймворк у стилі NestJS. **Частина 1** — IoC-контейнер, що читає
типи конструктора з метаданих і сам збирає граф залежностей. **Частина 2** — HTTP:
маршрутизація на декораторах і валідація вхідних даних поверх `node:http`, без
express/fastify і без `@nestjs/*`.

Це **частина 2 з 3**. Стартова точка — гілка `part-1-ioc`. Далі: Лекція 8 —
guards, interceptors, фільтри.

> ДЗ #6 (частина 1) здане в цьому ж репозиторії — контейнер тут наш власний, а не
> еталонний із демо лекції.

## Можливості

**Контейнер (частина 1)**

- `@Injectable({ scope? })` — позначає клас як придатний до створення контейнером.
- Резолв залежностей за `design:paramtypes` (типами конструктора), рекурсивно.
- `@Inject(token)` — явний токен для того, що не виражається типом.
- Скоупи `singleton` / `transient`; детекція циклів із людським повідомленням.

**HTTP-шар (частина 2)**

- `@Controller(prefix)` — базовий шлях контролера в метаданих (і неявний `@Injectable`).
- `@Get(path)` / `@Post(path)` — маршрут; повний шлях = `префікс + шлях методу`.
- `@Body()` / `@Param(name)` / `@Query(name)` — звідки диспетчер бере кожен аргумент.
- Диспетчер поверх `node:http`: знаходить маршрут, збирає аргументи, кличе метод
  через контейнер, серіалізує результат у JSON.
- `ValidationPipe` + DTO на `class-validator`: невалідне тіло → `400` зі списком
  `[{ field, constraints }]`; валідне → у метод приходить **екземпляр DTO**.

## Як запустити

```bash
npm install
npm test        # tsc + node --test; 21 passed, exit 0
npm start       # HTTP-сервер на http://localhost:3000

npm run dev        # nodemon: перезбирає (tsc) і перезапускає сервер на кожну зміну .ts
npm run test:watch # nodemon: перезапускає тести на кожну зміну в src/ або test/
```

> Чому саме перезбірка, а не запуск `.ts` напряму: декоратори потребують компіляції
> через `tsc` (нативний type-stripping Node не емітить `design:paramtypes`), тому
> dev-режим на кожну зміну робить `tsc && node dist/…`, а не запускає джерело як є.

Приклади запитів (сервер має бути піднятий через `npm start`):

```bash
curl localhost:3000/users            # список
curl localhost:3000/users/1          # @Param(':id')
curl "localhost:3000/users?limit=1"  # @Query('limit')

# @Body + валідація: валідне тіло → 201 з екземпляром DTO
curl -X POST localhost:3000/users -H 'content-type: application/json' \
     -d '{"email":"grace@example.com","name":"Grace"}'

# невалідне тіло → 400 зі списком полів
curl -X POST localhost:3000/users -H 'content-type: application/json' \
     -d '{"email":"not-an-email"}'
# {"statusCode":400,"message":"Validation failed",
#  "errors":[{"field":"email","constraints":["email must be an email"]}, ...]}
```

У Docker (перевикористовуючи сервіс `api`):

```bash
docker compose run --rm api npm test   # 21 passed, exit 0
```

## Як параметр-декоратор знає, куди підставити значення

Ключова ідея частини 2. Параметр-декоратор (`@Body`, `@Param`, `@Query`) отримує
від рушія рівно `(target, propertyKey, parameterIndex)`. Останній аргумент —
**позиція параметра в сигнатурі методу** — і є природним ключем. Тому декоратор
нічого не «витягує» з запиту: він лише **записує в метадані**, звідки цей аргумент
треба буде взяти. На класі контролера накопичується мапа

```
{ [methodName]: { [parameterIndex]: { source: 'body' | 'param' | 'query', name } } }
```

Наприклад, `getOne(@Param('id') id: string)` кладе `{ 0: { source: 'param', name: 'id' } }`.

Саму підстановку робить **диспетчер під час виклику**, а не декоратор. Отримавши
запит і знайшовши маршрут, він читає цю мапу й будує масив аргументів **за
індексами**: для індексу `0` бачить `{source:'param', name:'id'}` → бере
`pathParams.id`; для `{source:'query'}` → `url.searchParams.get(name)`; для
`{source:'body'}` → розпарсене тіло, пропущене через `ValidationPipe`. Готовий
масив іде в `controller[method](...args)`. Тобто декоратор — це **оголошення
наміру** в метаданих, а не читання даних; читання відкладене до моменту виклику.

Важлива деталь про порядок: параметр-декоратори виконуються **до** декоратора
методу, а той — **до** декоратора класу. Наша реалізація на цей порядок не
покладається (усі три пишуть незалежні метадані на конструктор, а диспетчер читає
їх усі разом уже після визначення класу), і це підтверджено тестом у
`test/router.test.ts`.

## Структура

| Файл | Призначення |
| --- | --- |
| `src/decorators/injectable.ts` | `@Injectable()` (частина 1) |
| `src/decorators/inject.ts` | `@Inject(token)` (частина 1) |
| `src/container.ts` | контейнер: резолв, скоупи, цикли (частина 1) |
| `src/tokens.ts` | типи токенів і well-known токен `CONFIG` |
| `src/decorators/controller.ts` | `@Controller(prefix)` |
| `src/decorators/methods.ts` | `@Get` / `@Post` |
| `src/decorators/params.ts` | `@Body`, `@Param`, `@Query` |
| `src/router.ts` | збір маршрутів із метаданих + матчинг `:param` |
| `src/dispatcher.ts` | HTTP-шар поверх `node:http` |
| `src/pipes/validation.pipe.ts` | валідація DTO (`plainToInstance` → `validate`) |
| `src/dto/create-user.dto.ts` | DTO з правилами |
| `src/users/*.ts` | демо-сервіс і контролер |
| `src/app.ts` / `src/index.ts` | складання застосунку / точка входу |
| `test/` | тести (`node:test` + вбудований `fetch`) |

## Як це працює (контейнер, частина 1)

Коли на класі стоїть **хоч один декоратор** і в `tsconfig.json` увімкнено
`emitDecoratorMetadata`, компілятор TypeScript додає виклик
`Reflect.metadata("design:paramtypes", [Тип1, Тип2, ...])` — масив **типів
параметрів конструктора**. Контейнер у момент `resolve` читає цей масив через
`Reflect.getMetadata('design:paramtypes', Target)`, рекурсивно резолвить кожен
елемент як залежність, а потім робить `new Target(...залежності)`. Клас **без
жодного декоратора цих метаданих не отримує взагалі**, а без `emitDecoratorMetadata`
компілятор їх не генерує. Окремий випадок — інтерфейси: у рантаймі їх немає, тому в
`design:paramtypes` вони стають `Object` — саме для таких залежностей існує
`@Inject(token)`.

Той самий механізм читання `design:paramtypes` HTTP-шар використовує **для методів**:
за індексом параметра, позначеного `@Body()`, диспетчер бере з
`design:paramtypes` клас DTO і в нього перетворює тіло перед валідацією.

## Обмеження реалізації

- Свій контейнер і своя маршрутизація, без сторонніх фреймворків (`@nestjs/*`,
  `express`, `fastify`, `inversify`, `tsyringe`, `typedi`).
- Дозволені бібліотеки: `reflect-metadata`, `class-validator` + `class-transformer`.
- TypeScript 6.x; `experimentalDecorators` + `emitDecoratorMetadata`.
- Тести ганяються по **скомпільованому** коду (`tsc` → `node --test dist/`), бо
  нативний type-stripping Node не емітить `design:paramtypes` — потрібен справжній `tsc`.
