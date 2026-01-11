import { Controller, Get } from '@nestjs/common';

@Controller('admin')
export class AdminEnvController {
  @Get('env-check')
  envCheck() {
    return {
      hasAdminDebugToken: !!process.env.ADMIN_DEBUG_TOKEN,
      tokenLength: process.env.ADMIN_DEBUG_TOKEN
        ? process.env.ADMIN_DEBUG_TOKEN.length
        : 0,
      nodeEnv: process.env.NODE_ENV ?? null,
    };
  }
}
