import { Injectable } from '../decorators/injectable';
import { getRequestId } from '../context/request-context';

/**
 * Демонстрація, заради якої існує AsyncLocalStorage: сервіс, що логує з
 * прив'язкою до запиту, але **не приймає** `requestId` параметром. Його
 * викликають на два рівні глибше обробника (handler → UserService → сюди), а id
 * він дістає зі сховища запиту — той самий, що й скрізь у цьому запиті.
 *
 * Зверни увагу на сигнатуру `log(message)` — жодного id-аргументу. Якби ми
 * тягли id вручну, його довелося б проносити крізь кожен виклик кожного шару;
 * саме цю «прошивку параметром» ALS і прибирає.
 */
@Injectable()
export class RequestLogService {
  log(message: string): void {
    const requestId = getRequestId(); // читаємо зі сховища, не з аргументу
    console.log(`[${requestId ?? 'no-request-context'}] ${message}`);
  }
}
