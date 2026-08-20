import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Container } from '../src/container';
import { Dispatcher } from '../src/dispatcher';
import { Controller } from '../src/decorators/controller';
import { Get, Post } from '../src/decorators/methods';
import { Body, Param } from '../src/decorators/params';
import { UseGuards } from '../src/decorators/use-guards';
import { AuthGuard } from '../src/guards/auth.guard';
import { LoggingInterceptor } from '../src/interceptors/logging.interceptor';
import { NotFoundError } from '../src/http/exceptions';
import { CreateUserDto } from '../src/dto/create-user.dto';

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

/** Перехопити `console.log` на час `fn`, повернути зібрані рядки. */
async function captureLog(fn: () => Promise<void>): Promise<string[]> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}

// ── Guard блокує ДО обробника ────────────────────────────────────────────────

let adminHandlerCalls = 0;

@Controller('admin')
@UseGuards(AuthGuard)
class AdminController {
  @Get()
  secret() {
    adminHandlerCalls++;
    return { ok: true };
  }
}

test('guard: запит без Authorization → 403, і обробник не викликається', async () => {
  adminHandlerCalls = 0;
  const dispatcher = new Dispatcher(new Container()).register(AdminController);
  await withServer(dispatcher, async (base) => {
    const res = await fetch(`${base}/admin`);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.statusCode, 403);
  });
  assert.equal(adminHandlerCalls, 0, 'обробник не мав виконатись за відмови guard');
});

test('guard: із валідним Bearer-токеном → 200, обробник виконується', async () => {
  adminHandlerCalls = 0;
  const dispatcher = new Dispatcher(new Container()).register(AdminController);
  await withServer(dispatcher, async (base) => {
    const res = await fetch(`${base}/admin`, {
      headers: { authorization: 'Bearer s3cret' },
    });
    assert.equal(res.status, 200);
  });
  assert.equal(adminHandlerCalls, 1, 'авторизований запит мав дійти до обробника');
});

// ── Interceptor міряє час ────────────────────────────────────────────────────

@Controller('timed')
class TimedController {
  @Get()
  ping() {
    return { pong: true };
  }
}

test('interceptor: у лозі є маршрут і тривалість у мілісекундах', async () => {
  const dispatcher = new Dispatcher(new Container())
    .useInterceptors(new LoggingInterceptor())
    .register(TimedController);

  const lines = await captureLog(async () => {
    await withServer(dispatcher, async (base) => {
      const res = await fetch(`${base}/timed`);
      assert.equal(res.status, 200);
    });
  });

  const logLine = lines.find((l) => l.includes('/timed'));
  assert.ok(logLine, 'LoggingInterceptor мав щось залоґувати для /timed');
  assert.match(logLine!, /[0-9]+(\.[0-9]+)? ?ms/); // напр. "GET /timed — 1.2 ms"
});

// ── Pipe на Zod: невалідне тіло → 400 зі списком полів ────────────────────────

@Controller('signup')
class SignupController {
  @Post()
  create(@Body() dto: CreateUserDto) {
    return dto;
  }
}

test('pipe(zod): невалідне тіло → 400 зі списком полів', async () => {
  const dispatcher = new Dispatcher(new Container()).register(SignupController);
  await withServer(dispatcher, async (base) => {
    const res = await fetch(`${base}/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', name: 'x' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(Array.isArray(body.errors));
    assert.ok(body.errors.some((e: { field: string }) => e.field === 'email'));
    assert.match(JSON.stringify(body), /email/);
  });
});

test('pipe(zod): валідне тіло → екземпляр DTO у методі, age приведено до числа', async () => {
  let received: unknown;
  @Controller('signup2')
  class Signup2Controller {
    @Post()
    create(@Body() dto: CreateUserDto) {
      received = dto;
      return { ok: true };
    }
  }
  const dispatcher = new Dispatcher(new Container()).register(Signup2Controller);
  await withServer(dispatcher, async (base) => {
    const res = await fetch(`${base}/signup2`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'grace@example.com', name: 'Grace', age: '30' }),
    });
    assert.equal(res.status, 201);
  });
  assert.ok(received instanceof CreateUserDto, 'body має бути екземпляром DTO');
  assert.equal((received as CreateUserDto).age, 30); // z.coerce.number: '30' → 30
});

// ── Exception filter ловить несподіване ───────────────────────────────────────

@Controller('boom')
class BoomController {
  @Get()
  explode() {
    throw new Error('boom');
  }
}

test('filter: несподівана помилка → 500 без тексту помилки й стек-трейсу назовні', async () => {
  const dispatcher = new Dispatcher(new Container()).register(BoomController);
  await withServer(dispatcher, async (base) => {
    const res = await fetch(`${base}/boom`);
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.doesNotMatch(text, /boom/, 'текст помилки не має протікати клієнту');
    assert.doesNotMatch(text, /at .*\.ts:/, 'стек-трейс не має протікати клієнту');
  });
});

// ── Доменна помилка мапиться у 404 ────────────────────────────────────────────

@Controller('thing')
class ThingController {
  @Get(':id')
  getOne(@Param('id') id: string) {
    throw new NotFoundError(`thing ${id} not found`);
  }
}

test('filter: NotFoundError → 404 з осмисленим повідомленням', async () => {
  const dispatcher = new Dispatcher(new Container()).register(ThingController);
  await withServer(dispatcher, async (base) => {
    const res = await fetch(`${base}/thing/5`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.statusCode, 404);
    assert.match(body.message, /thing 5 not found/);
  });
});
