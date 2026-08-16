import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Constructor } from '../tokens';

/** Одне поле з помилкою: назва + список причин (усі порушені правила). */
export interface FieldError {
  field: string;
  constraints: string[];
}

/**
 * Помилка валідації. Несе список полів, а не «перше, що впало», — диспетчер
 * віддасть його клієнту як `400` з деталями.
 */
export class ValidationError extends Error {
  constructor(public readonly errors: FieldError[]) {
    super('Validation failed');
    this.name = 'ValidationError';
  }
}

/**
 * Типи, які не є DTO і валідувати нічого: тіло під таким «типом» лишаємо як є
 * (напр. `@Body() body: any` дасть у метаданих `Object`).
 */
const NON_VALIDATABLE: readonly unknown[] = [String, Number, Boolean, Array, Object];

/**
 * Простий Pipe валідації в дусі Nest.
 *
 * Ключовий нюанс, на якому спотикаються всі: `class-validator` перевіряє
 * **екземпляри класів**, а не plain-обʼєкти. Сире тіло запиту — це plain-обʼєкт
 * після `JSON.parse`, на ньому декоратори `@IsEmail()` тощо не спрацюють. Тому
 * порядок жорсткий:
 *   1) `plainToInstance(Dto, body)` — «оживляємо» тіло у справжній екземпляр DTO;
 *   2) `validate(instance)` — тепер правила видно.
 * Без першого кроку валідатор мовчки нічого не перевірить.
 *
 * Успіх → повертаємо **екземпляр DTO** (а не сирий обʼєкт), тож у метод
 * контролера приходить `body instanceof CreateUserDto === true`.
 * Провал → кидаємо `ValidationError` зі списком `[{ field, constraints }]`.
 */
export class ValidationPipe {
  async transform(value: unknown, metatype: Constructor | undefined): Promise<unknown> {
    // Немає класу DTO або це примітив/Object — валідувати нічого.
    if (!metatype || NON_VALIDATABLE.includes(metatype)) {
      return value;
    }

    const instance = plainToInstance(metatype, value);
    const errors = await validate(instance as object, {
      whitelist: true, //           відкидаємо поля, яких немає в DTO
      forbidUnknownValues: true, //  плоский null/примітив замість обʼєкта — теж помилка
    });

    if (errors.length > 0) {
      throw new ValidationError(
        errors.map((e) => ({
          field: e.property,
          constraints: Object.values(e.constraints ?? {}),
        })),
      );
    }

    return instance;
  }
}
