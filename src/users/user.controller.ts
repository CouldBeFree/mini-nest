import { Controller } from '../decorators/controller';
import { Get, Post } from '../decorators/methods';
import { Body, Param, Query } from '../decorators/params';
import { HttpResponse } from '../dispatcher';
import { CreateUserDto } from '../dto/create-user.dto';
import { UserService } from './user.service';

/**
 * Контролер користувачів. Демонструє всі частини ДЗ #7 разом:
 *   - `@Controller('users')` — префікс;
 *   - `@Get(':id')` / `@Post()` — маршрути, повний шлях = префікс + шлях методу;
 *   - `@Param` / `@Query` / `@Body` — звідки брати аргументи;
 *   - `UserService` через конструктор — його створює контейнер (частина 1).
 *
 * Жоден метод не читає `req`/`res` вручну: значення вже підставлені як аргументи.
 */
@Controller('users')
export class UserController {
  // `public readonly` — щоб тест міг перевірити, що це той самий singleton,
  // який віддає контейнер.
  constructor(public readonly users: UserService) {}

  /** GET /users?limit=5 — `limit` приходить окремим аргументом із query. */
  @Get()
  list(@Query('limit') limit?: string) {
    const parsed = limit === undefined ? undefined : Number(limit);
    return this.users.findAll(parsed);
  }

  /** GET /users/:id — `id` приходить із сегмента маршруту, не з `req`. */
  @Get(':id')
  getOne(@Param('id') id: string) {
    const user = this.users.findOne(Number(id));
    if (!user) {
      return new HttpResponse(404, { statusCode: 404, message: `User ${id} not found` });
    }
    return user;
  }

  /** POST /users — валідне тіло приходить екземпляром CreateUserDto. */
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }
}
