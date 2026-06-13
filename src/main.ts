import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, RequestMethod } from '@nestjs/common';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module.js';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const logger = new Logger('Bootstrap');

  app.use(helmet());
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));
  // OAuth provider, discovery metadata, MCP endpoint, and the GPT Action
  // spec live at the root — external clients expect them unprefixed.
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'oauth/authorize', method: RequestMethod.ALL },
      { path: 'oauth/consent', method: RequestMethod.ALL },
      { path: 'oauth/token', method: RequestMethod.ALL },
      { path: 'oauth/revoke', method: RequestMethod.ALL },
      { path: 'oauth/register', method: RequestMethod.ALL },
      {
        path: '.well-known/oauth-authorization-server',
        method: RequestMethod.ALL,
      },
      { path: '.well-known/openid-configuration', method: RequestMethod.ALL },
      {
        path: '.well-known/oauth-protected-resource',
        method: RequestMethod.ALL,
      },
      {
        path: '.well-known/oauth-protected-resource/mcp',
        method: RequestMethod.ALL,
      },
      {
        path: '.well-known/apple-developer-domain-association.txt',
        method: RequestMethod.ALL,
      },
      { path: 'mcp', method: RequestMethod.ALL },
      { path: 'openapi.json', method: RequestMethod.ALL },
      { path: 'favicon.ico', method: RequestMethod.ALL },
      { path: 'favicon.png', method: RequestMethod.ALL },
      { path: 'icon-192.png', method: RequestMethod.ALL },
      { path: 'icon-512.png', method: RequestMethod.ALL },
      { path: 'apple-icon.png', method: RequestMethod.ALL },
    ],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new PrismaExceptionFilter(), new HttpExceptionFilter());

  app.enableCors();
  app.enableShutdownHooks();

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`Wolog API running on port ${port}`);
}
bootstrap();
