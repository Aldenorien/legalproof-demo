// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS : on ouvre à toutes les origines pour la phase de dev/sandbox
  app.enableCors({
    origin: true, // autorise http://localhost:5173, http://localhost:4173, etc.
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  });

  await app.listen(3000);
}
bootstrap();
