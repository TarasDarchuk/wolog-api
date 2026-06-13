import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigModule } from './config/config.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { SyncModule } from './sync/sync.module.js';
import { ExercisesModule } from './exercises/exercises.module.js';
import { SharesModule } from './shares/shares.module.js';
import { OAuthModule } from './oauth/oauth.module.js';
import { RoutinesModule } from './routines/routines.module.js';
import { WorkoutsModule } from './workouts/workouts.module.js';
import { McpModule } from './mcp/mcp.module.js';
import { OpenApiModule } from './openapi/openapi.module.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { FaviconController } from './common/favicon.controller.js';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
    ScheduleModule.forRoot(),
    HealthModule,
    AuthModule,
    UsersModule,
    SyncModule,
    ExercisesModule,
    SharesModule,
    OAuthModule,
    RoutinesModule,
    WorkoutsModule,
    McpModule,
    OpenApiModule,
  ],
  controllers: [FaviconController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
