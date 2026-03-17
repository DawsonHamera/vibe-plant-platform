import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { mkdirSync } from "node:fs";
import { AppModule } from "./app.module";
import { getRuntimeConfig } from "./config/runtime-config";

async function bootstrap(): Promise<void> {
  const runtime = getRuntimeConfig();
  const app = await NestFactory.create(AppModule);

  mkdirSync(runtime.uploadsDir, { recursive: true });
  (app as unknown as { useStaticAssets: (path: string, options: { prefix: string }) => void }).useStaticAssets(
    runtime.uploadsDir,
    { prefix: "/uploads" },
  );

  app.enableCors({
    origin: runtime.corsOrigins,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen(runtime.port, runtime.host);
}

bootstrap();
