# Пояснення: що і чому зроблено

Цей документ — розбір завдання та готового проєкту «своїми словами»: у чому суть,
які рішення прийнято і чому саме так. README описує *як користуватись*; тут — *чому
воно так влаштоване*.

---

## 1. У чому суть завдання

NestJS дозволяє писати так:

```ts
@Injectable()
class UserService {
  constructor(private db: Database, private logger: Logger) {}
}
```

…і ніде не викликати `new Database()` чи `new Logger()` вручну — Nest сам створює
їх і підставляє в конструктор. Питання, на яке відповідає це ДЗ: **звідки Nest
знає, що `UserService` залежить саме від `Database` і `Logger`?**

Відповідь несподівано проста: TypeScript за нас записує типи параметрів
конструктора в метадані, а «контейнер» (наш `Container`) їх читає й рекурсивно
будує весь граф. Уся «магія» `@Injectable()` — це буквально два рядки
`Reflect.defineMetadata`. Мета частини 1 — написати цей контейнер самотужки, щоб
магії не лишилось.

---

## 2. Механізм, на якому все тримається

```
                emitDecoratorMetadata (tsconfig)
                          │
   @Injectable() ─────────┤  наявність декоратора змушує tsc
   на класі               ▼  записати в JS-код:
              Reflect.metadata('design:paramtypes', [Database, Logger])
                          │
                          ▼
   Container.resolve(UserService):
      types = Reflect.getMetadata('design:paramtypes', UserService)  // [Database, Logger]
      args  = types.map(t => this.resolve(t))                        // рекурсія!
      return new UserService(...args)
```

Три умови, без яких нічого не працює (і кожна — типова причина «чому в мене не
резолвиться»):

1. **`import 'reflect-metadata'`** найпершим рядком — він додає `Reflect.getMetadata`/
   `defineMetadata`, яких у стандартному `Reflect` немає.
2. **`emitDecoratorMetadata: true`** — без нього tsc не генерує `design:paramtypes`
   взагалі, і контейнер не бачить, що конструктор має аргументи.
3. **Хоч один декоратор на класі** — метадані «вішаються» тільки на декорований
   клас. Клас без `@Injectable()` не отримає `design:paramtypes`, навіть коли прапор
   увімкнено.

---

## 3. З чого складається проєкт

| Файл | Що робить | Ключова ідея |
| --- | --- | --- |
| `src/decorators/injectable.ts` | `@Injectable({scope})` | 2× `defineMetadata`: прапорець + скоуп |
| `src/decorators/inject.ts` | `@Inject(token)` | мапа `індекс параметра -> токен` на класі |
| `src/container.ts` | контейнер | `resolve` = читання метаданих + рекурсія + кеш + детекція циклів |
| `src/tokens.ts` | типи токенів, `CONFIG` | токен = `клас | symbol | string` |
| `test/*.test.ts` | тести | покривають усі пункти acceptance |
| `src/index.ts` | демо | `npm start` показує граф у дії |

---

## 4. Ключові рішення і чому саме так

### 4.1. Чому `tsc` + `node:test`, а не vitest/tsx/ts-node
Найважливіше технічне рішення. Багато тест-раннерів (vitest, tsx, нативний
type-stripping Node) компілюють TypeScript через **esbuild/swc**, які **не
підтримують `emitDecoratorMetadata`**: типи вони зрізають, але `design:paramtypes`
не емітять. Наслідок — контейнер отримав би порожні метадані й тихо ламався. Тому
тести ганяються по коду, скомпільованому **справжнім `tsc`**: `pretest` робить
збірку, `npm test` запускає `node --test` по `dist/`. Це гарантує, що метадані
реальні, і не тягне жодної зайвої залежності (тест-раннер — вбудований у Node).

### 4.2. Чому TypeScript 6, а не 7
За умовою. Сьома версія щойно вийшла, але для цього ДЗ нічого не додає, тож беремо
стабільну 6.x (`npm i -D typescript@6`). Побічно це знімає низку сюрпризів 7-ки
(наприклад, там прибрали `moduleResolution: "node"`).

### 4.3. `@Injectable()` — рівно два `defineMetadata`
`injectable.ts` пише прапорець `INJECTABLE_KEY = true` (щоб контейнер знав, що клас
можна створювати) і `SCOPE_KEY` (singleton/transient). Більше декоратору робити
нічого не треба: головну роботу — запис `design:paramtypes` — виконує сам факт його
наявності разом з `emitDecoratorMetadata`.

### 4.4. `@Inject(token)` — бо типів не завжди досить
Інтерфейси при компіляції стираються: у метаданих замість `interface AppConfig`
опиняється `Object`. Резолвити «за Object» безглуздо. Тому для інтерфейсів і
готових значень існує явний токен. `@Inject` — це параметр-декоратор, який
складає на класі мапу `{ індекс параметра -> токен }`. Під час резолву контейнер
для кожного параметра бере **токен, якщо він є**, інакше — тип із `design:paramtypes`.

### 4.5. Скоупи — один прапорець і одна мапа-кеш
Контейнер тримає `#singletons: Map<token, instance>`. Після створення екземпляра:
якщо скоуп `singleton` — кладемо в кеш під токеном (наступний `resolve` поверне те
саме); якщо `transient` — не кешуємо взагалі, тож щоразу `new`. `useValue`-провайдери
повертаються напряму — це теж фактично singleton.

### 4.6. Детекція циклів — впорядкований `Set` шляху
Наївна рекурсія на `A → B → A` дала б `RangeError: Maximum call stack size exceeded`
— марна помилка. Тому в рекурсію передається `path` — впорядкована множина класів,
які **зараз** конструюються. Перед входом у конструктор перевіряємо: якщо клас уже
в `path` — це цикл, кидаємо `CircularDependencyError` з
`[...path, current].map(name).join(' -> ')`, тобто `A -> B -> A`. Перевірка стоїть
**до** конструювання і **до** кешу, тому спрацьовує раніше за переповнення стека.
Важлива деталь: для кожного рівня рекурсії створюється **новий** `Set` (`new Set(path)`),
щоб «сусідні» гілки графа не заважали одна одній (спільна залежність — не цикл).

### 4.7. Guard-и з людськими повідомленнями
- Резолв класу без `@Injectable()` → зрозуміле «class is not decorated with @Injectable()»,
  а не падіння в `new` з дивною помилкою.
- Резолв незареєстрованого `symbol`/`string`-токена → «No provider registered for token …»
  з підказкою, як зареєструвати.

---

## 5. Як рішення лягають на acceptance criteria

| Критерій | Де це в коді/тестах |
| --- | --- |
| Немає чужих контейнерів | лише `reflect-metadata`; `grep` по `@nestjs|inversify|tsyringe|typedi` порожній |
| Метадані ввімкнено | `tsconfig.json`: `experimentalDecorators` + `emitDecoratorMetadata` |
| Резолв через метадані | `container.ts`: `Reflect.getMetadata('design:paramtypes', target)` |
| Рекурсивний граф | тест `A -> B -> C`, перевіряє живий `C` усередині |
| Singleton | тест `resolve(X) === resolve(X)` |
| Transient | тест `resolve(X) !== resolve(X)` для `scope: 'transient'` |
| `@Inject(token)` | тест з `Symbol.for('CONFIG')` та `useValue` |
| Цикл | тест матчить `/A -> B -> A/` і перевіряє, що це не `RangeError` |
| Тести проходять | `npm test` → 8 passed, exit 0 |
| Docker | `docker compose run --rm api npm test` → 8 passed, exit 0 |

---

## 6. Як перевірити самому

```bash
npm test                              # 8 passed, exit 0
npm start                             # [log] Привіт, світ!
docker compose run --rm api npm test  # те саме в контейнері

# grep-критерії:
grep -RE "@nestjs|inversify|tsyringe|typedi" package.json src/   # порожньо
grep -rn "design:paramtypes" src/                                # є збіг
```

---

## 7. Що далі й чому так написано

Репозиторій житиме до Лекції 8, тому код навмисно лишає точки розширення:
- **Провайдери** вже не тільки класи (`useClass`/`useValue`) — далі легко додати
  `useFactory`.
- **Резолв** відокремлений від реєстрації — під контролери (Лекція 7) та
  pipes/guards/interceptors (Лекція 8) достатньо буде додати нові типи метаданих,
  не переписуючи ядро.
- **Скоупи** зведені до однієї мапи-кешу — місце для майбутнього `request`-скоупу.

Головний висновок: після цієї роботи `@Injectable()` — не магія, а два
`Reflect.defineMetadata` плюс один `Reflect.getMetadata('design:paramtypes')` на
боці контейнера.
