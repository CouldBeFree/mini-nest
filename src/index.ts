import 'reflect-metadata';
import { createApp } from './app';

// Точка входу для `npm start`: піднімаємо HTTP-сервер на маршрутах-декораторах.
// Спробуйте:
//   curl localhost:3000/users
//   curl localhost:3000/users/1
//   curl localhost:3000/users?limit=1
//   curl -X POST localhost:3000/users -H 'content-type: application/json' \
//        -d '{"email":"grace@example.com","name":"Grace"}'
//   curl -X POST localhost:3000/users -H 'content-type: application/json' \
//        -d '{"email":"not-an-email","name":"x"}'   # → 400 з полем email

const PORT = Number(process.env.PORT ?? 3000);

createApp().dispatcher.listen(PORT);
