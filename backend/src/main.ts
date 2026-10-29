import "reflect-metadata";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";

loadEnv({ path: resolve(process.cwd(), "../.env") });

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Counterfeit Verification API")
    .setDescription("MVP API for medicine batch and pack verification.")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    "docs",
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
}

bootstrap().catch((error: unknown) => {
  console.error("Failed to start the backend:", error);
  process.exitCode = 1;
});
