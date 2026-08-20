import type { ZodType } from 'zod';
import type { ArgumentMetadata, PipeTransform } from '../http/lifecycle';
import { ValidationError, type FieldError } from '../http/exceptions';

/**
 * DTO-клас, який несе свою Zod-схему у статичному полі `schema`. Клас лишається
 * як «ім'я типу» (його бачить `design:paramtypes` за індексом `@Body()`), а всі
 * правила живуть у схемі. Так метатип аргументу → його схема без окремого реєстру.
 */
export interface SchemaCarrier {
  schema: ZodType;
}

/** Метатип має Zod-схему? Тоді це DTO, який ми валідуємо. */
function hasSchema(metatype: unknown): metatype is (new () => object) & SchemaCarrier {
  return (
    typeof metatype === 'function' &&
    'schema' in metatype &&
    typeof (metatype as SchemaCarrier).schema?.safeParse === 'function'
  );
}

/**
 * Pipe валідації на **Zod 4** (замість `class-validator` із ДЗ #7).
 *
 * Чому pipe, а не крок усередині диспетчера: валідація — це трансформація ОДНОГО
 * аргументу перед обробником. Оформлена як pipe, вона (1) не знає про HTTP,
 * (2) підключається/замінюється точково, (3) стоїть у циклі рівно там, де треба —
 * після guard/interceptor(before), перед handler.
 *
 * Працює лише над аргументами, чий метатип несе Zod-схему (тобто над `@Body()`
 * з DTO). Param/query (метатип `String`/`Object`) проходять наскрізь незмінними.
 *
 * Успіх → повертає **екземпляр DTO** (а не plain-обʼєкт): Zod дає провалідовані
 * дані, ми «оживляємо» їх у клас, тож у метод приходить `body instanceof Dto`.
 * Провал → кидає `ValidationError` зі списком `[{ field, constraints }]`
 * (Zod 4 тримає причини в `error.issues`, не `error.errors`, як у Zod 3).
 */
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const { metatype } = metadata;
    if (!hasSchema(metatype)) return value; // нема схеми — валідувати нічого

    const result = metatype.schema.safeParse(value);
    if (!result.success) {
      throw new ValidationError(groupIssues(result.error.issues));
    }

    // «Оживляємо» провалідовані дані в екземпляр DTO-класу.
    return Object.assign(new metatype(), result.data);
  }
}

/** Zod-issues (path+message) → `[{ field, constraints }]`, згрупувавши за полем. */
function groupIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[]): FieldError[] {
  const byField = new Map<string, string[]>();
  for (const issue of issues) {
    const field = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    const list = byField.get(field) ?? [];
    list.push(issue.message);
    byField.set(field, list);
  }
  return [...byField].map(([field, constraints]) => ({ field, constraints }));
}
