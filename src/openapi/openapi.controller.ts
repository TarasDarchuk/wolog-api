import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../common/decorators/public.decorator.js';
import { buildConnectorOpenApiSpec } from './connector-spec.js';

/** Serves the GPT Action spec at /openapi.json (outside the API prefix). */
@Public()
@Controller('openapi.json')
export class OpenApiController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  spec() {
    return buildConnectorOpenApiSpec(
      this.config.get<string>('PUBLIC_BASE_URL') || 'http://localhost:3000',
    );
  }
}
