import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../src/router';
import { Controller } from '../src/decorators/controller';
import { Get, Post } from '../src/decorators/methods';
import { Param, Query, Body } from '../src/decorators/params';
import { getParamMap } from '../src/decorators/params';

@Controller('users')
class DemoController {
  @Get(':id')
  getOne(@Param('id') _id: string) {
    return null;
  }

  @Get()
  list(@Query('limit') _limit?: string) {
    return null;
  }

  @Post()
  create(@Body() _dto: unknown) {
    return null;
  }
}

test('маршрути беруться з декораторів, а не з захардкодженого списку', () => {
  const router = new Router().register(DemoController);
  const paths = router.routes.map((r) => `${r.method} ${r.fullPath}`).sort();
  assert.deepEqual(paths, ['GET /users', 'GET /users/:id', 'POST /users']);
});

test('префікс контролера склеюється зі шляхом методу', () => {
  const router = new Router().register(DemoController);
  const one = router.routes.find((r) => r.handlerName === 'getOne');
  assert.equal(one?.fullPath, '/users/:id');
});

test('match знаходить маршрут і витягує :param у pathParams', () => {
  const router = new Router().register(DemoController);
  const found = router.match('GET', '/users/42');

  assert.ok(found, 'маршрут має знайтись');
  assert.equal(found.route.handlerName, 'getOne');
  assert.equal(found.pathParams.id, '42');
});

test('match повертає null для невідомого шляху або методу', () => {
  const router = new Router().register(DemoController);
  assert.equal(router.match('GET', '/nope'), null);
  assert.equal(router.match('DELETE', '/users/1'), null);
});

// Порядок декораторів навмисно «пастковий»: `:id` оголошено ПЕРЕД `me`.
// Наївний first-match-wins віддав би `/spec/me` у byId (`:id` захопив би 'me').
@Controller('spec')
class SpecController {
  @Get(':id')
  byId(@Param('id') _id: string) {
    return { hit: 'byId' };
  }

  @Get('me')
  me() {
    return { hit: 'me' };
  }
}

test('специфічний маршрут виграє в :param незалежно від порядку реєстрації', () => {
  const router = new Router().register(SpecController);

  // /spec/me має піти в літеральний me(), а не в :id — попри те, що :id оголошено раніше
  const me = router.match('GET', '/spec/me');
  assert.ok(me, 'маршрут /spec/me має знайтись');
  assert.equal(me.route.handlerName, 'me');

  // а конкретний id усе одно потрапляє в :param
  const byId = router.match('GET', '/spec/42');
  assert.ok(byId, 'маршрут /spec/42 має знайтись');
  assert.equal(byId.route.handlerName, 'byId');
  assert.equal(byId.pathParams.id, '42');
});

test('параметр-декоратор пише в метадані source+name за індексом аргументу', () => {
  // Це підтверджує підказку: index — і є ключ мапи.
  const map = getParamMap(DemoController, 'getOne');
  assert.deepEqual(map[0], { source: 'param', name: 'id' });

  const listMap = getParamMap(DemoController, 'list');
  assert.deepEqual(listMap[0], { source: 'query', name: 'limit' });

  const createMap = getParamMap(DemoController, 'create');
  assert.equal(createMap[0].source, 'body');
});
