import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Container } from '../src/container';
import { Injectable } from '../src/decorators/injectable';
import { Inject } from '../src/decorators/inject';
import { CONFIG } from '../src/tokens';

// Інтерфейс існує лише під час компіляції: у метаданих він стане Object.
// Саме тому залежність від нього треба брати за токеном, а не за типом.
interface AppConfig {
  url: string;
}

test('@Inject резолвить залежність за токеном Symbol.for("CONFIG"), а не за типом', () => {
  @Injectable()
  class Database {
    constructor(@Inject(CONFIG) readonly config: AppConfig) {}
  }

  const container = new Container();
  container.register(CONFIG, { useValue: { url: 'postgres://localhost:5432' } });

  const db = container.resolve(Database);
  assert.equal(db.config.url, 'postgres://localhost:5432');
});

test('незареєстрований токен дає зрозумілу помилку "No provider registered"', () => {
  @Injectable()
  class NeedsToken {
    constructor(@Inject(Symbol.for('MISSING')) readonly x: unknown) {}
  }

  assert.throws(
    () => new Container().resolve(NeedsToken),
    /No provider registered/,
  );
});
