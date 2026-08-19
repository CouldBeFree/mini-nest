import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Container } from '../src/container';
import { Dispatcher, HttpResponse } from '../src/dispatcher';
import { UserController } from '../src/users/user.controller';
import { UserService } from '../src/users/user.service';
import { CreateUserDto } from '../src/dto/create-user.dto';
import { Controller } from '../src/decorators/controller';
import { Post } from '../src/decorators/methods';
import { Body } from '../src/decorators/params';

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

const app = () => new Dispatcher(new Container()).register(UserController);

test('префікс склеюється: GET /users/1 доходить до контролера (200 + @Param)', async () => {
  await withServer(app(), async (base) => {
    const res = await fetch(`${base}/users/1`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, 1);
    assert.equal(body.email, 'ada@example.com');
  });
});

test('@Param працює: GET /users/42 — id доходить до методу (тіло містить 42)', async () => {
  await withServer(app(), async (base) => {
    const res = await fetch(`${base}/users/42`);
    const text = await res.text();
    assert.match(text, /42/); // id 42 дійшов до обробника і сформував відповідь
  });
});

test('@Query працює: GET /users?limit=1 — limit доходить окремим аргументом', async () => {
  await withServer(app(), async (base) => {
    const res = await fetch(`${base}/users?limit=1`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.length, 1); // з 2 засіяних лишився 1 → limit=1 дійшов
  });
});

test('@Body працює: POST /users з валідним JSON → 201 і розпарсене тіло', async () => {
  await withServer(app(), async (base) => {
    const res = await fetch(`${base}/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'grace@example.com', name: 'Grace' }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.email, 'grace@example.com');
    assert.equal(body.name, 'Grace');
    assert.ok(typeof body.id === 'number');
  });
});

test('валідація відхиляє: POST /users з невалідним email → 400 зі списком полів', async () => {
  await withServer(app(), async (base) => {
    const res = await fetch(`${base}/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', name: 'x' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(JSON.stringify(body), /email/); // тіло згадує поле email
    // помилки — список [{ field, constraints }], а не «перше поле»
    assert.ok(Array.isArray(body.errors));
    assert.ok(body.errors.some((e: { field: string }) => e.field === 'email'));
  });
});

test('битий JSON у тілі → 400, а не 500', async () => {
  await withServer(app(), async (base) => {
    const res = await fetch(`${base}/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ email: broken',
    });
    assert.equal(res.status, 400);
  });
});

test('завелике тіло → 413, а не роздування памʼяті (лічильник байтів)', async () => {
  // Ліміт 16 байтів — тіло свідомо більше, тож читання має обірватись на 413.
  const tiny = new Dispatcher(new Container(), 16).register(UserController);
  await withServer(tiny, async (base) => {
    const res = await fetch(`${base}/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'grace@example.com', name: 'Grace' }), // >16 байтів
    });
    assert.equal(res.status, 413);
    const body = await res.json();
    assert.equal(body.statusCode, 413);
  });
});

test('тіло в межах ліміту читається нормально (413 не спрацьовує зайве)', async () => {
  // Той самий валідний запит зі щедрим лімітом проходить як завжди.
  const roomy = new Dispatcher(new Container(), 1024).register(UserController);
  await withServer(roomy, async (base) => {
    const res = await fetch(`${base}/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'grace@example.com', name: 'Grace' }),
    });
    assert.equal(res.status, 201);
  });
});

test('ланцюжок обгортає виклик обробника: interceptor трансформує результат (ДЗ#8-seam)', async () => {
  const dispatcher = new Dispatcher(new Container()).register(UserController);
  // Ланка-інтерсептор: викликає обробник і обгортає його результат.
  dispatcher.use(async (ctx, next) => {
    const result = await next();
    return { wrapped: result, handler: ctx.handlerName };
  });
  await withServer(dispatcher, async (base) => {
    const res = await fetch(`${base}/users/1`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.handler, 'getOne'); // ланка бачить контекст маршруту
    assert.equal(body.wrapped.id, 1); // і обгорнула справжній результат обробника
  });
});

test('ланка може відхилити запит, не викликаючи обробник (guard-стиль)', async () => {
  let handlerRan = false;
  const dispatcher = new Dispatcher(new Container()).register(UserController);
  // Guard: НЕ викликає next() → обробник не запускається зовсім.
  dispatcher.use(async () => new HttpResponse(403, { statusCode: 403, message: 'Forbidden' }));
  dispatcher.use(async (_ctx, next) => {
    handlerRan = true; // ця ланка стоїть глибше за guard — до неї не має дійти
    return next();
  });
  await withServer(dispatcher, async (base) => {
    const res = await fetch(`${base}/users/1`);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.message, 'Forbidden');
  });
  assert.equal(handlerRan, false, 'глибша ланка не мала виконатись після відмови guard');
});

test('кілька ланок — onion-порядок: зовнішня обгортає внутрішню', async () => {
  const order: string[] = [];
  const dispatcher = new Dispatcher(new Container()).register(UserController);
  dispatcher
    .use(async (_ctx, next) => {
      order.push('A:before');
      const r = await next();
      order.push('A:after');
      return r;
    })
    .use(async (_ctx, next) => {
      order.push('B:before');
      const r = await next();
      order.push('B:after');
      return r;
    });
  await withServer(dispatcher, async (base) => {
    await fetch(`${base}/users/1`);
  });
  // Зареєстрована першою (A) — зовнішня: обгортає B, а B обгортає обробник.
  assert.deepEqual(order, ['A:before', 'B:before', 'B:after', 'A:after']);
});

test('валідація пропускає: у метод приходить екземпляр CreateUserDto, не plain-обʼєкт', async () => {
  // Пробний контролер ловить те, що реально дійшло до обробника через диспетчер.
  let received: unknown;

  @Controller('probe')
  class ProbeController {
    @Post()
    create(@Body() dto: CreateUserDto) {
      received = dto;
      return { ok: true };
    }
  }

  const dispatcher = new Dispatcher(new Container()).register(ProbeController);
  await withServer(dispatcher, async (base) => {
    const res = await fetch(`${base}/probe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'grace@example.com', name: 'Grace' }),
    });
    assert.equal(res.status, 201);
  });

  assert.ok(received instanceof CreateUserDto, 'body має бути екземпляром DTO');
});

test('контейнер із частини 1 задіяно: контролер і контейнер бачать той самий singleton сервісу', () => {
  const container = new Container();
  const controller = container.resolve(UserController);
  // Сервіс, інжектнутий у контролер, === сервіс, який віддає контейнер напряму.
  assert.strictEqual(controller.users, container.resolve(UserService));
});
