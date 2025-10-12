```typescript
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import morgan from 'morgan';
import { json, urlencoded } from 'body-parser';
import winston from 'winston';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3000;

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.Console({
      format:
        process.env.NODE_ENV === 'production'
          ? winston.format.json()
          : winston.format.combine(winston.format.colorize(), winston.format.simple()),
    }),
  ],
});

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(json());
app.use(urlencoded({ extended: true }));

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Health check endpoint
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// Placeholder for route registrations (expand as needed)
// Example:
// import userRoutes from './routes/user';
// app.use('/users', userRoutes);


// Error handling middleware
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error: %o', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Graceful shutdown
const shutdownSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

shutdownSignals.forEach(signal => {
  process.on(signal, () => {
    logger.info('Received %s signal, shutting down gracefully...', signal);
    server.close(err => {
      if (err) {
        logger.error('Error during server close: %o', err);
        process.exit(1);
      }
      logger.info('Server closed. Exiting process.');
      process.exit(0);
    });
  });
});

const server = app.listen(PORT, () => {
  logger.info(`SaMD server running on port ${PORT}`);
});
```