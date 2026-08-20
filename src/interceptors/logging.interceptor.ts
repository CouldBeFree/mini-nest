import type { ExecutionContext, Interceptor, Next } from '../http/lifecycle';
import { getRequestId } from '../context/request-context';

/**
 * Interceptor логування: міряє тривалість обробки й пише рядок
 *   `[<requestId>] GET /users/1 — 12.3 ms`
 *
 * Він обгортає виклик обробника: засікає час ДО `next()`, віддає керування далі
 * по циклу (interceptor → pipe → handler), а ПІСЛЯ — рахує різницю. Саме тому
 * тривалість вимірює interceptor, а не guard: guard стоїть до виклику й «виходу»
 * не бачить, а interceptor бачить і вхід, і вихід.
 *
 * `requestId` беремо зі сховища запиту (AsyncLocalStorage), а не з параметра —
 * той самий id, що й у решти коду цього запиту, і той, що піде клієнту в
 * заголовку `X-Request-Id`.
 *
 * `try/finally` — щоб залоґувати тривалість навіть коли обробник кинув помилку
 * (її далі зловить Exception Filter); інакше впалі запити не мали б метрики.
 */
export class LoggingInterceptor implements Interceptor {
  async intercept(ctx: ExecutionContext, next: Next): Promise<unknown> {
    const started = performance.now();
    const label = `${ctx.req.method} ${ctx.url.pathname}`;
    try {
      return await next();
    } finally {
      const ms = (performance.now() - started).toFixed(1);
      console.log(`[${getRequestId() ?? '-'}] ${label} — ${ms} ms`);
    }
  }
}
