import { Module } from '@nestjs/common';
import { AdaptyWebhookController } from './adapty-webhook.controller.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { AdaptyApiService } from './adapty-api.service.js';

@Module({
  controllers: [AdaptyWebhookController],
  providers: [SubscriptionsService, AdaptyApiService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
