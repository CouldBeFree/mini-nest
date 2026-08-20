import { Injectable } from '../decorators/injectable';
import { RequestLogService } from '../services/request-log.service';
import type { CreateUserDto } from '../dto/create-user.dto';

export interface User {
  id: number;
  email: string;
  name: string;
  age?: number;
}

/**
 * Звичайний `@Injectable`-сервіс із частини 1 — сховище користувачів у памʼяті.
 * Контейнер створює його як singleton і сам підставляє в конструктор
 * `RequestLogService` (граф залежностей із ДЗ #6).
 *
 * Тут немає жодного HTTP і жодного `requestId` у сигнатурах: коли `findOne`
 * логує через `RequestLogService`, id береться зі сховища запиту (ALS) на два
 * рівні глибше обробника — сервіс про нього навіть не знає.
 */
@Injectable()
export class UserService {
  readonly #users: User[] = [
    { id: 1, email: 'ada@example.com', name: 'Ada' },
    { id: 2, email: 'linus@example.com', name: 'Linus' },
  ];
  #nextId = 3;

  constructor(private readonly log: RequestLogService) {}

  findAll(limit?: number): User[] {
    return typeof limit === 'number' ? this.#users.slice(0, limit) : this.#users;
  }

  findOne(id: number): User | undefined {
    // Лог із прив'язкою до запиту, але без параметра-id: RequestLogService
    // дістане requestId зі сховища сам (демонстрація ALS «два рівні глибше»).
    this.log.log(`UserService.findOne(${id})`);
    return this.#users.find((u) => u.id === id);
  }

  create(dto: CreateUserDto): User {
    const user: User = { id: this.#nextId++, ...dto };
    this.#users.push(user);
    return user;
  }
}
