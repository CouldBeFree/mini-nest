# mini-nest

Мінімальний IoC-контейнер у стилі NestJS. Читає типи параметрів конструктора з
метаданих і сам рекурсивно збирає граф залежностей — те саме, що Nest робить під
капотом за `@Injectable()`.

Це **частина 1 з 3**. Далі: Лекція 7 — контролери й DTO; Лекція 8 — pipes,
guards, interceptors, фільтри.

## Можливості

- `@Injectable({ scope? })` — позначає клас як придатний до створення контейнером.
- Резолв залежностей за `design:paramtypes` (типами конструктора), рекурсивно.
- `@Inject(token)` — явний токен (`symbol`/`string`) для того, що не виражається типом (інтерфейси, значення).
- Скоупи: `singleton` (за замовчуванням, один екземпляр на контейнер) та `transient` (новий на кожен resolve).
- Детекція циклів: `A -> B -> A` кидає зрозумілу помилку з усім ланцюгом, а не `RangeError: Maximum call stack size exceeded`.

## Як запустити

```bash
npm install
npm test        # tsc + node --test; має бути 8 passed, exit 0
npm start       # демо: контейнер збирає граф і друкує "[log] Привіт, світ!"

npm run dev        # nodemon: перезбирає (tsc) і перезапускає app на кожну зміну .ts у src/
npm run test:watch # nodemon: перезапускає тести на кожну зміну в src/ або test/
```

> Чому саме перезбірка, а не запуск `.ts` напряму: декоратори потребують компіляції
> через `tsc` (нативний type-stripping Node не емітить `design:paramtypes`), тому
> dev-режим на кожну зміну робить `tsc && node dist/…`, а не запускає джерело як є.

У Docker (перевикористовуючи сервіс `api`):

```bash
docker compose run --rm api npm test
```

## Приклад

```ts
import 'reflect-metadata';
import { Container } from './src/container';
import { Injectable } from './src/decorators/injectable';
import { Inject } from './src/decorators/inject';
import { CONFIG } from './src/tokens';

@Injectable()
class Logger {}

@Injectable()
class Service {
  constructor(
    private readonly logger: Logger,               // за типом
    @Inject(CONFIG) private readonly config: unknown, // за токеном
  ) {}
}

const container = new Container();
container.register(CONFIG, { useValue: { url: '...' } });
const service = container.resolve(Service); // Logger створюється автоматично
```

## Структура

| Файл | Призначення |
| --- | --- |
| `src/decorators/injectable.ts` | декоратор `@Injectable()` |
| `src/decorators/inject.ts` | параметр-декоратор `@Inject(token)` |
| `src/container.ts` | сам контейнер (резолв, скоупи, цикли) |
| `src/tokens.ts` | типи токенів і well-known токен `CONFIG` |
| `src/index.ts` | демо-точка входу для `npm start` |
| `test/` | тести (`node:test`) |

## Як це працює

Коли на класі стоїть **хоч один декоратор** і в `tsconfig.json` увімкнено
`emitDecoratorMetadata`, компілятор TypeScript додає в скомпільований код виклик
`Reflect.metadata("design:paramtypes", [Тип1, Тип2, ...])` — масив **типів
параметрів конструктора**, тобто посилань на реальні класи. Контейнер у момент
`resolve` читає цей масив через `Reflect.getMetadata('design:paramtypes', Target)`,
рекурсивно резолвить кожен елемент як залежність, а потім робить
`new Target(...залежності)`. Саме тому клас **без жодного декоратора не отримує
цих метаданих узагалі** (компілятору нема на що їх «повісити»), а без
`emitDecoratorMetadata` компілятор їх просто не генерує — і контейнеру нема звідки
дізнатися, що конструктор взагалі має аргументи. Окремий випадок — інтерфейси:
у рантаймі їх не існує, тому в `design:paramtypes` вони перетворюються на `Object`.
Це стирання типів, а не обмеження контейнера — і саме для таких залежностей
існує `@Inject(token)`, який задає явний ключ пошуку замість (безкорисного тут) типу.

## Обмеження реалізації

- Свій контейнер, без сторонніх DI-бібліотек (`@nestjs/*`, `inversify`, `tsyringe`, `typedi`).
- TypeScript 6.x; `experimentalDecorators` + `emitDecoratorMetadata`.
- Тести ганяються по **скомпільованому** коду (`tsc` → `node --test dist/`), бо
  нативний type-stripping Node не емітить `design:paramtypes` — потрібен справжній `tsc`.
