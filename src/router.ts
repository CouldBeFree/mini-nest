import 'reflect-metadata';
import type { Constructor } from './tokens';
import { getControllerPrefix, isController } from './decorators/controller';
import { getRoutes, type HttpMethod } from './decorators/methods';
import { getParamMap, type ParamMap } from './decorators/params';

/**
 * Маршрут у «скомпільованому» вигляді — усе, що диспетчеру треба для одного
 * ендпоінта, вже дістано з метаданих і складено докупи.
 */
export interface CompiledRoute {
  method: HttpMethod;
  /** Повний шлях: `префікс контролера + шлях методу`, напр. `/users/:id`. */
  fullPath: string;
  /** Сегменти шляху для матчингу (`['users', ':id']`). */
  segments: string[];
  controller: Constructor;
  handlerName: string;
  /** Мапа `index -> {source, name}` з параметр-декораторів. */
  params: ParamMap;
  /**
   * Типи аргументів методу (`design:paramtypes`). Потрібні валідації: за
   * індексом `@Body()` звідси беремо клас DTO, у який перетворювати тіло.
   */
  paramTypes: unknown[];
}

/** Результат матчингу: маршрут + витягнуті значення `:param`-сегментів. */
export interface RouteMatch {
  route: CompiledRoute;
  /** Значення маршрут-параметрів за іменами: `{ id: '42' }`. */
  pathParams: Record<string, string>;
}

/**
 * Маршрутизатор: збирає маршрути з декораторів (жодного захардкодженого списку
 * шляхів) і вміє знайти маршрут за HTTP-методом та шляхом запиту.
 */
export class Router {
  readonly #routes: CompiledRoute[] = [];

  /** Прочитати всі маршрути класу-контролера й додати їх у таблицю. */
  register(controller: Constructor): this {
    if (!isController(controller)) {
      throw new Error(
        `"${controller.name}" is not a controller — decorate it with @Controller().`,
      );
    }

    const prefix = getControllerPrefix(controller);
    const proto = controller.prototype;

    for (const route of getRoutes(controller)) {
      const fullPath = joinPath(prefix, route.path);
      this.#routes.push({
        method: route.method,
        fullPath,
        segments: toSegments(fullPath),
        controller,
        handlerName: route.handlerName,
        params: getParamMap(controller, route.handlerName),
        paramTypes:
          Reflect.getMetadata('design:paramtypes', proto, route.handlerName) ?? [],
      });
    }
    return this;
  }

  /** Усі зареєстровані маршрути (для інтроспекції/тестів). */
  get routes(): readonly CompiledRoute[] {
    return this.#routes;
  }

  /**
   * Знайти маршрут за методом і шляхом. Повертає `null`, якщо збігу немає.
   * Матчинг посегментний: літеральний сегмент має збігтися точно, а `:name`
   * — «джокер», що захоплює будь-яке значення в змінну `name`.
   */
  match(method: string, pathname: string): RouteMatch | null {
    const reqSegments = toSegments(pathname);

    for (const route of this.#routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== reqSegments.length) continue;

      const pathParams: Record<string, string> = {};
      let matched = true;

      for (let i = 0; i < route.segments.length; i++) {
        const routeSeg = route.segments[i];
        const reqSeg = reqSegments[i];
        if (routeSeg.startsWith(':')) {
          pathParams[routeSeg.slice(1)] = decodeURIComponent(reqSeg);
        } else if (routeSeg !== reqSeg) {
          matched = false;
          break;
        }
      }

      if (matched) return { route, pathParams };
    }
    return null;
  }
}

/** Склейка префікса контролера й шляху методу в один повний шлях. */
function joinPath(prefix: string, path: string): string {
  const full = `${prefix}${path}`;
  return full === '' ? '/' : full;
}

/** Розбити шлях на непорожні сегменти: `/users/:id` → `['users', ':id']`. */
function toSegments(pathname: string): string[] {
  return pathname.split('/').filter((s) => s.length > 0);
}
