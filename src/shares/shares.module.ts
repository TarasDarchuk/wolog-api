import { Module } from '@nestjs/common';
import { SharesController } from './shares.controller.js';
import { SharesService } from './shares.service.js';

@Module({
  controllers: [SharesController],
  providers: [SharesService],
  exports: [SharesService],
})
export class SharesModule {}
