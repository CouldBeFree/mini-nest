import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Container } from '../src/container';
import { Dispatcher } from '../src/dispatcher';
import { Controller } from '../src/decorators/controller';
import { Get } from '../src/decorators/methods';
import { Injectable } from '../src/decorators/injectable';
import { getRequestId } from '../src/context/request-context';
import { UserController } from '../src/users/user.controller';

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

// Сервіс, який навмисно «засинає» перед читанням id — так під час await event loop
// встигне переключитись на інший запит. Якби id жив у глобальній змінній, після
// пробудження ми прочитали б ЧУЖИЙ id; ALS дає кожному запиту власне сховище.
@Injectable()
class EchoService {
  async whoAmI(): Promise<string> {
    await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 20)));
    return getRequestId() ?? 'none'; // читання зі сховища, без параметра
  }
}

@Controller('echo')
class EchoController {
  constructor(private readonly echo: EchoService) {}

  @Get()
  async me() {
    const requestId = await this.echo.whoAmI();
    return { requestId };
  }
}

test('X-Request-Id: якщо клієнт не прислав — сервер генерує і повертає його', async () => {
  const dispatcher = new Dispatcher(new Container()).register(EchoController);
  await withServer(dispatcher, async (base) => {
    const res = await fetch(`${base}/echo`);
    const header = res.headers.get('x-request-id');
    assert.ok(header && header.length > 0, 'заголовок X-Request-Id має бути у відповіді');
    const body = await res.json();
    // Той самий id, що згенерував сервер, дістався і глибокому сервісу.
    assert.equal(body.requestId, header);
  });
});

test('X-Request-Id: якщо клієнт прислав свій — повертається саме він', async () => {
  const dispatcher = new Dispatcher(new Container()).register(EchoController);
  await withServer(dispatcher, async (base) => {
    const res = await fetch(`${base}/echo`, {
      headers: { 'x-request-id': 'trace-from-client' },
    });
    assert.equal(res.headers.get('x-request-id'), 'trace-from-client');
    const body = await res.json();
    assert.equal(body.requestId, 'trace-from-client');
  });
});

test('ALS: сервіс на два рівні глибше обробника бачить той самий requestId', async () => {
  // handler getOne → UserService.findOne → RequestLogService.log (2 рівні),
  // де id береться зі сховища. Ловимо лог і звіряємо з надісланим id.
  const dispatcher = new Dispatcher(new Container()).register(UserController);
  let header: string | null = null;
  const lines = await captureLog(async () => {
    await withServer(dispatcher, async (base) => {
      const res = await fetch(`${base}/users/1`, {
        headers: { 'x-request-id': 'deep-trace-1' },
      });
      header = res.headers.get('x-request-id');
    });
  });
  assert.equal(header, 'deep-trace-1');
  assert.ok(
    lines.includes('[deep-trace-1] UserService.findOne(1)'),
    `глибокий сервіс мав залоґувати з тим самим id; отримано: ${JSON.stringify(lines)}`,
  );
});

test('ALS: 10 паралельних запитів не змішують requestId між собою', async () => {
  const dispatcher = new Dispatcher(new Container()).register(EchoController);
  await withServer(dispatcher, async (base) => {
    const ids = Array.from({ length: 10 }, (_, i) => `req-${i}`);

    const results = await Promise.all(
      ids.map(async (id) => {
        const res = await fetch(`${base}/echo`, { headers: { 'x-request-id': id } });
        const body = await res.json();
        return { sent: id, header: res.headers.get('x-request-id'), deep: body.requestId };
      }),
    );

    for (const { sent, header, deep } of results) {
      assert.equal(header, sent, `заголовок відповіді протік: ${header} замість ${sent}`);
      assert.equal(deep, sent, `глибоке читання протекло: ${deep} замість ${sent}`);
    }
  });
});
