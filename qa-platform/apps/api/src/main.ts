import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/zod-exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const webOrigin = `http://localhost:${process.env.WEB_PORT ?? 3000}`;

  // The web app proxies /api/* to here (same-origin in the browser), so CORS is
  // normally moot; this stays permissive for the proxied origin + direct access.
  app.enableCors({ origin: webOrigin, credentials: true });
  app.use(cookieParser());
  app.use(
    session({
      secret: process.env.SESSION_SECRET ?? 'dev-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());
  // DTO validation is done with zod inside controllers/services (see @qa/shared).
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`[api] Breadfast QA Platform API listening on http://localhost:${port}`);
}

bootstrap();
