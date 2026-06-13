import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module.js';
import { OAuthController } from './oauth.controller.js';
import { WellKnownController } from './well-known.controller.js';
import { OAuthService } from './oauth.service.js';
import { OAuthClientService } from './oauth-client.service.js';
import { OAuthTokenService } from './oauth-token.service.js';
import {
  ConnectorAuthGuard,
  OptionalConnectorAuthGuard,
} from '../common/guards/connector-auth.guard.js';

@Module({
  imports: [
    AuthModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [OAuthController, WellKnownController],
  providers: [
    OAuthService,
    OAuthClientService,
    OAuthTokenService,
    ConnectorAuthGuard,
    OptionalConnectorAuthGuard,
  ],
  exports: [
    OAuthTokenService,
    ConnectorAuthGuard,
    OptionalConnectorAuthGuard,
    JwtModule,
  ],
})
export class OAuthModule {}
