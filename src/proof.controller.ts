// src/proof.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { AgeProofService } from './age-proof.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';

@Controller('proof')
export class ProofController {
  constructor(private readonly ageProofService: AgeProofService) {}

  /**
   * GET /proof/status
   * Protégé par JWT:
   * - Authorization: Bearer <token>
   * Le wallet_pubkey provient du token (req.user.wallet_pubkey).
   */
  @UseGuards(JwtAuthGuard)
  @Get('status')
  async getStatus(@Req() req: Request & { user?: any }) {
    const tokenWallet = (req.user?.wallet_pubkey || '').trim();
    if (!tokenWallet) {
      throw new UnauthorizedException('Invalid token payload (missing wallet_pubkey)');
    }

    return this.ageProofService.getAge18PlusStatus(tokenWallet);
  }

  /**
   * POST /proof/revoke
   * Protégé par JWT:
   * - Authorization: Bearer <token>
   * - Pour éviter toute ambiguïté: on révoque le wallet du token (pas celui du body).
   *
   * Body optionnel:
   * { "claim_type": "AGE_18_PLUS" }  (par défaut AGE_18_PLUS)
   */
  @UseGuards(JwtAuthGuard)
  @Post('revoke')
  async revokeProof(
    @Req() req: Request & { user?: any },
    @Body('claim_type') claimType?: string,
    @Body('wallet_pubkey') walletPubkeyIgnored?: string, // ignoré volontairement
  ) {
    const tokenWallet = (req.user?.wallet_pubkey || '').trim();
    if (!tokenWallet) {
      throw new UnauthorizedException('Invalid token payload (missing wallet_pubkey)');
    }

    const ct = (claimType ?? 'AGE_18_PLUS').trim();
    if (ct !== 'AGE_18_PLUS') {
      throw new BadRequestException(`claim_type non supporté pour l’instant: ${ct}`);
    }

    // On révoque uniquement la preuve du wallet authentifié
    return this.ageProofService.revokeAge18PlusClaim(tokenWallet);
  }
}
