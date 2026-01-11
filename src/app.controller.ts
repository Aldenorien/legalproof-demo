import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('ping')
  ping() {
    return { status: 'ok', source: 'legalproof-provider' };
  }

  @Get('health')
  health() {
    return { ok: true };
  }

  // DEBUG DE DEPLOIEMENT (temporaire)
  @Get('version')
  version() {
    return {
      name: 'legalproof-provider',
      build_tag: '2026-01-09-senddeploy-v1',
      ts: new Date().toISOString(),
    };
  }
}
