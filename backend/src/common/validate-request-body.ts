import { BadRequestException } from "@nestjs/common";
import { plainToInstance, type ClassConstructor } from "class-transformer";
import { validate } from "class-validator";

export async function validateRequestBody<T extends object>(
  body: unknown,
  dtoClass: ClassConstructor<T>,
): Promise<T> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestException("A JSON request body is required");
  }

  const instance = plainToInstance(dtoClass, body);
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length > 0) {
    const messages = errors.flatMap((error) =>
      Object.values(error.constraints ?? {}),
    );
    throw new BadRequestException(messages);
  }

  return instance;
}
