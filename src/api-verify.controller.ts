// src/api-verify.controller.ts
import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { AgeProofService } from './age-proof.service';

@Controller('api')
export class ApiVerifyController {
  constructor(private readonly ageProofService: AgeProofService) {}

  /**
   * GET /api/verify?wallet_pubkey=...&claim_type=AGE_18_PLUS
   *
   * Paramètres query :
   * - wallet_pubkey (obligatoire) : clé publique Casper de l’utilisateur
   * - claim_type (optionnel) : pour l’instant, uniquement "AGE_18_PLUS"
   *
   * Réponse :
   * {
   *   wallet_pubkey: string;
   *   claim_type: string;
   *   status: {
   *     wallet_pubkey: string;
   *     has_proof: boolean;
   *     is_major: boolean;         // true = majeur 18+ ET preuve valide
   *     revoked: boolean;
   *     valid_from: number | null; // timestamps Unix (secondes)
   *     valid_until: number | null;
   *     deploy_hash: string | null;
   *   }
   * }
   *
   * Note importante :
   * - Aucune date de naissance ni information personnelle brute n’est renvoyée.
   * - L’intégrateur obtient seulement un statut agrégé de majorité.
   */
  @Get('verify')
  async verify(
    @Query('wallet_pubkey') walletPubkey?: string,
    @Query('claim_type') claimType?: string,
  ) {
    if (!walletPubkey || !walletPubkey.trim()) {
      throw new BadRequestException('wallet_pubkey est requis');
    }

    const normalizedWallet = walletPubkey.trim();
    const normalizedClaimType = (claimType ?? 'AGE_18_PLUS').trim();

    if (normalizedClaimType !== 'AGE_18_PLUS') {
      throw new BadRequestException(
        'claim_type non supporté (seul AGE_18_PLUS est disponible pour l’instant)',
      );
    }

    const status = await this.ageProofService.getAge18PlusStatus(
      normalizedWallet,
    );

    return {
      wallet_pubkey: normalizedWallet,
      claim_type: normalizedClaimType,
      status,
    };
  }
}
