import { Injectable } from '../decorators/injectable';
import type { CreateUserDto } from '../dto/create-user.dto';

export interface User {
  id: number;
  email: string;
  name: string;
  age?: number;
}

/**
 * Звичайний `@Injectable`-сервіс із частини 1 — сховище користувачів у памʼяті.
 * Контейнер створює його як singleton і підставляє в контролер через
 * конструктор. Тут немає жодного HTTP: сервіс не знає про запити.
 */
@Injectable()
export class UserService {
  readonly #users: User[] = [
    { id: 1, email: 'ada@example.com', name: 'Ada' },
    { id: 2, email: 'linus@example.com', name: 'Linus' },
  ];
  #nextId = 3;

  findAll(limit?: number): User[] {
    return typeof limit === 'number' ? this.#users.slice(0, limit) : this.#users;
  }

  findOne(id: number): User | undefined {
    return this.#users.find((u) => u.id === id);
  }

  create(dto: CreateUserDto): User {
    const user: User = { id: this.#nextId++, ...dto };
    this.#users.push(user);
    return user;
  }
}
