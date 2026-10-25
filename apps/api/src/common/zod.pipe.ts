import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** Validates and normalizes request input with the shared zod contract (D-032). */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    const errors = result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
    throw new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      message: errors[0]?.message ?? 'Input tidak valid.',
      errors,
    });
  }
}

