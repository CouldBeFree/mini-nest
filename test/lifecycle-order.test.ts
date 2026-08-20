import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Container } from '../src/container';
import {
  Dispatcher,
  type CanActivate,
  type ExecutionContext,
  type Interceptor,
  type Middleware,
  type Next,
  type PipeTransform,
} from '../src/dispatcher';
import { Controller } from '../src/decorators/controller';
import { Get } from '../src/decorators/methods';
import { Param } from '../src/decorators/params';

/** Піднімає диспетчер на випадковому порту, віддає базовий URL, потім закриває. */
async function withServer(
  dispatcher: Dispatcher,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const server = dispatcher.createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://localhost:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// Спільний масив міток: кожна стадія циклу дописує свою назву тоді, коли реально
// виконується. Так тест фіксує не «щось викликалось», а точний ПОРЯДОК.
const order: string[] = [];

const spyMiddleware: Middleware = async (_ctx: ExecutionContext, next: Next) => {
  order.push('middleware');
  return next();
};

const spyGuard: CanActivate = {
  canActivate() {
    order.push('guard');
    return true; // пускаємо далі — цей тест про щасливий шлях усіх шести стадій
  },
};

const spyInterceptor: Interceptor = {
  async intercept(_ctx: ExecutionContext, next: Next) {
    order.push('interceptor:before');
    const result = await next();
    order.push('interceptor:after');
    return result;
  },
};

const spyPipe: PipeTransform = {
  transform(value: unknown) {
    order.push('pipe');
    return value;
  },
};

@Controller('order')
class OrderController {
  // Один аргумент (@Param) → pipe спрацює рівно раз, мітка 'pipe' не задублюється.
  @Get(':id')
  run(@Param('id') _id: string) {
    order.push('handler');
    return { ok: true };
  }
}

test('життєвий цикл виконує стадії в точному порядку', async () => {
  order.length = 0;

  const dispatcher = new Dispatcher(new Container())
    .use(spyMiddleware)
    .useGuards(spyGuard)
    .useInterceptors(spyInterceptor)
    .usePipes(spyPipe)
    .register(OrderController);

  await withServer(dispatcher, async (base) => {
    const res = await fetch(`${base}/order/1`);
    assert.equal(res.status, 200);
  });

  // Middleware → Guard → Interceptor(before) → Pipe → Handler → Interceptor(after)
  assert.deepEqual(order, [
    'middleware',
    'guard',
    'interceptor:before',
    'pipe',
    'handler',
    'interceptor:after',
  ]);
});
