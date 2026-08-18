import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container, CircularDependencyError } from '../src/container';
import { Injectable } from '../src/decorators/injectable';
import { Inject } from '../src/decorators/inject';

test('рекурсивно збирає граф залежностей (A -> B -> C) з живим C усередині', () => {
  // Порядок оголошення — від листа до кореня, щоб типи вже існували
  // на момент, коли emitDecoratorMetadata записує design:paramtypes.
  @Injectable()
  class C {
    value(): number {
      return 42;
    }
  }
  @Injectable()
  class B {
    constructor(readonly c: C) {}
  }
  @Injectable()
  class A {
    constructor(readonly b: B) {}
  }

  const a = new Container().resolve(A);

  assert.ok(a instanceof A);
  assert.ok(a.b instanceof B);
  assert.ok(a.b.c instanceof C); // живий C усередині
  assert.equal(a.b.c.value(), 42);
});

test('singleton (за замовчуванням) повертає той самий екземпляр', () => {
  @Injectable()
  class Service {}

  const container = new Container();
  assert.strictEqual(container.resolve(Service), container.resolve(Service));
});

test('transient повертає новий екземпляр на кожен resolve', () => {
  @Injectable({ scope: 'transient' })
  class Service {}

  const container = new Container();
  assert.notStrictEqual(container.resolve(Service), container.resolve(Service));
});

test('спільна singleton-залежність — один і той самий екземпляр у різних споживачів', () => {
  @Injectable()
  class Shared {}
  @Injectable()
  class Left {
    constructor(readonly shared: Shared) {}
  }
  @Injectable()
  class Right {
    constructor(readonly shared: Shared) {}
  }

  const container = new Container();
  assert.strictEqual(
    container.resolve(Left).shared,
    container.resolve(Right).shared,
  );
});

test('цикл A -> B -> A кидає осмислену помилку з ланцюгом, а не RangeError', () => {
  // Циклічний граф неможливо оголосити прямими типами (temporal dead zone),
  // тому звʼязуємо класи рядковими токенами через @Inject.
  @Injectable()
  class A {
    constructor(@Inject('B') readonly b: unknown) {}
  }
  @Injectable()
  class B {
    constructor(@Inject('A') readonly a: unknown) {}
  }

  const container = new Container()
    .register('A', { useClass: A })
    .register('B', { useClass: B });

  assert.throws(
    () => container.resolve('A'),
    (err: unknown) => {
      assert.ok(err instanceof CircularDependencyError);
      assert.ok(!(err instanceof RangeError), 'не має бути RangeError (переповнення стека)');
      assert.match((err as Error).message, /A -> B -> A/);
      return true;
    },
  );
});

test('resolve незареєстрованого класу без @Injectable дає зрозумілу помилку', () => {
  class Plain {} // навмисно без декоратора

  assert.throws(
    () => new Container().resolve(Plain),
    /is not decorated with @Injectable/,
  );
});
