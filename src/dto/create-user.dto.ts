import { z } from 'zod';
import type { SchemaCarrier } from '../pipes/zod-validation.pipe';

/**
 * Схема створення користувача на **Zod 4**. Тримаємо її окремою константою, щоб
 * і `CreateUserDto`, і будь-хто інший міг перевикористати чи вивести з неї тип.
 *
 * Zod 4 відрізняється від Zod 3: формати рядка стали топ-рівневими (`z.email()`
 * замість `z.string().email()`), а причини помилок лежать у `error.issues`
 * (не `error.errors`). `z.coerce.number()` приводить `age` до числа, навіть якщо
 * з JSON воно прийшло рядком.
 */
export const createUserSchema = z.object({
  email: z.email(),
  name: z.string().min(2, 'name must be at least 2 characters'),
  age: z.coerce.number().int().min(0).max(150).optional(),
});

/** Тип валідного тіла — виведений зі схеми, тож не розʼїжджається з правилами. */
export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * DTO лишається класом — це «ім'я типу», яке `design:paramtypes` бачить за
 * індексом `@Body()`. Правила ж живуть у Zod-схемі, доступній через статичне
 * поле `schema` (за ним `ZodValidationPipe` знаходить, чим валідувати). Після
 * успішної валідації pipe «оживляє» дані саме в екземпляр цього класу.
 */
export class CreateUserDto implements CreateUserInput {
  static readonly schema = createUserSchema satisfies SchemaCarrier['schema'];

  email!: string;
  name!: string;
  age?: number;
}
