import { Injectable } from '../decorators/injectable';
import type { CanActivate, ExecutionContext } from '../http/lifecycle';

/**
 * Guard автентифікації: пускає далі лише запити з заголовком `Authorization`
 * у форматі `Bearer <token>`. Немає заголовка / чужа схема → `canActivate`
 * повертає `false`, і диспетчер відповідає `403` ще ДО валідації й обробника.
 *
 * Guard відповідає на єдине питання — «пускати чи ні» — і НЕ читає тіло, НЕ
 * змінює результат. Саме тому він у циклі стоїть найпершим (після middleware):
 * відсікти неавторизований запит дешевше, ніж читати й валідувати його тіло.
 *
 * `@Injectable`, бо guard дістає контейнер (як і будь-який провайдер) — тут
 * залежностей нема, але завтра сюди можна інжектнути, скажімо, TokenService.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const header = ctx.req.headers['authorization'];
    return typeof header === 'string' && /^Bearer\s+\S+/.test(header);
  }
}
