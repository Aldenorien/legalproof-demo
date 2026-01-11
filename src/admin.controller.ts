import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AgeProofService } from './age-proof.service';
import { AdminDebugGuard } from './admin-debug.guard';

@Controller('admin')
@UseGuards(AdminDebugGuard)
export class AdminController {
  constructor(private readonly ageProofService: AgeProofService) {}

  /**
   * GET /admin/age-proofs?wallet_pubkey=...&limit=50
   * Protégé par x-admin-token
   */
  @Get('age-proofs')
  async listAgeProofs(
    @Query('wallet_pubkey') walletPubkey: string,
    @Query('limit') limit?: string,
  ) {
    const wallet = (walletPubkey || '').trim();
    if (!wallet) {
      throw new BadRequestException('wallet_pubkey est requis');
    }

    let take = 50;
    if (limit?.trim()) {
      const n = parseInt(limit.trim(), 10);
      if (!Number.isInteger(n) || n < 1 || n > 500) {
        throw new BadRequestException('limit doit être un entier entre 1 et 500');
      }
      take = n;
    }

    return this.ageProofService.listAgeProofsForWallet(wallet, take);
  }
}
