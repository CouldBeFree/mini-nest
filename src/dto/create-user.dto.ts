import { IsEmail, IsInt, IsOptional, IsString, MinLength, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO створення користувача з правилами-декораторами.
 *
 * Правила «висять» на полях як метадані — `class-validator` читає їх під час
 * `validate(instance)`. Саме тому валідувати треба **екземпляр** цього класу
 * (див. `ValidationPipe`), а не сирий обʼєкт після `JSON.parse`.
 */
export class CreateUserDto {
  /** Має бути схожим на email — інакше `400` з полем `email`. */
  @IsEmail()
  email!: string;

  /** Непорожнє імʼя щонайменше з 2 символів. */
  @IsString()
  @MinLength(2)
  name!: string;

  /**
   * Необовʼязковий вік. `@Type(() => Number)` потрібен, бо з JSON число може
   * прийти рядком; class-transformer приведе його до `number` перед перевіркою.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(150)
  age?: number;
}
