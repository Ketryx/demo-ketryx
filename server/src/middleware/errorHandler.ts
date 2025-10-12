```typescript
import { NextFunction, Request, Response } from 'express';

interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
  details?: unknown;
}

const DEFAULT_STATUS_CODE = 500;
const DEFAULT_ERROR_MESSAGE = 'An unexpected error occurred';

function classifyError(err: any): AppError {
  if (err.name === 'ValidationError') {
    const error = new Error('Validation failed') as AppError;
    error.statusCode = 400;
    error.isOperational = true;
    error.details = err.errors || err.message;
    return error;
  }

  if (err.name === 'CastError') {
    const error = new Error('Invalid resource identifier') as AppError;
    error.statusCode = 400;
    error.isOperational = true;
    return error;
  }

  if (err.statusCode && typeof err.statusCode === 'number') {
    err.isOperational = err.isOperational !== false;
    return err;
  }

  const genericError = new Error(DEFAULT_ERROR_MESSAGE) as AppError;
  genericError.statusCode = DEFAULT_STATUS_CODE;
  genericError.isOperational = false;
  return genericError;
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const correlationId = req.headers['x-correlation-id'] || req.id || 'unknown';

  let error: AppError;
  if (err instanceof Error) {
    error = classifyError(err);
  } else {
    error = new Error(DEFAULT_ERROR_MESSAGE) as AppError;
    error.statusCode = DEFAULT_STATUS_CODE;
    error.isOperational = false;
  }

  const statusCode = error.statusCode || DEFAULT_STATUS_CODE;
  const isProd = process.env.NODE_ENV === 'production';

  // Log error with correlation ID
  // eslint-disable-next-line no-console
  console.error(
    `[Error] [Correlation ID: ${correlationId}]`,
    error.name,
    error.message,
    error.details || '',
    error.stack || ''
  );

  // Client-safe error response
  const responsePayload = {
    status: 'error',
    correlationId,
    message: error.isOperational
      ? error.message
      : DEFAULT_ERROR_MESSAGE,
    ...(isProd
      ? {}
      : {
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
            details: error.details,
          },
        }),
  };

  res.status(statusCode).json(responsePayload);
}
```