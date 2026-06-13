import { Controller, Get, Header, StreamableFile } from '@nestjs/common';
import { Public } from './decorators/public.decorator.js';
import { WOLOG_ICON_PNG } from '../assets/wolog-icon.js';

/**
 * Serves the Wolog brand icon at the conventional favicon/icon paths so
 * clients that derive a connector/site icon from the host (e.g. claude.ai's
 * connector card) show the Wolog mark instead of the host's default favicon.
 * Routes live at the root (excluded from the /api/v1 prefix in main.ts).
 */
@Public()
@Controller()
export class FaviconController {
  // PNG bytes are valid for all these paths; .ico consumers accept image/png.
  // StreamableFile sends the raw Buffer (returning it directly would be
  // UTF-8-serialized and corrupt the binary).
  @Get(['favicon.ico', 'favicon.png', 'icon-192.png', 'icon-512.png', 'apple-icon.png'])
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'public, max-age=86400')
  icon(): StreamableFile {
    return new StreamableFile(WOLOG_ICON_PNG, { type: 'image/png' });
  }
}
