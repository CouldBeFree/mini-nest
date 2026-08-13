import 'reflect-metadata';
import { Container } from './container';
import { Injectable } from './decorators/injectable';
import { Inject } from './decorators/inject';
import { CONFIG } from './tokens';

// Демонстрація: контейнер сам збирає граф Greeter -> Logger та підставляє
// конфіг за токеном CONFIG. Запуск: `npm start` (після `npm run build`).

interface AppConfig {
  greeting: string;
}

@Injectable()
class Logger {
  log(message: string): void {
    console.log(`[log] ${message}`);
  }
}

@Injectable()
class Greeter {
  constructor(
    private readonly logger: Logger, //          резолвиться за типом
    @Inject(CONFIG) private readonly config: AppConfig, // за токеном
  ) {}

  greet(name: string): void {
    this.logger.log(`${this.config.greeting}, ${name}!`);
  }
}

const container = new Container();
container.register(CONFIG, { useValue: { greeting: 'Привіт' } });

// Один виклик resolve — і весь граф зібрано.
container.resolve(Greeter).greet('світ');
