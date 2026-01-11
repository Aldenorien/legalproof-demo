import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { ChallengeResponseDto, VerifyRequestDto, VerifyResponseDto } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('challenge')
  async challenge(@Query('wallet_pubkey') walletPubkey: string): Promise<ChallengeResponseDto> {
    return this.authService.createChallenge(walletPubkey);
  }

  @Post('verify')
  async verify(@Body() body: VerifyRequestDto): Promise<VerifyResponseDto> {
    return this.authService.verifySignatureAndIssueToken(body);
  }
}
