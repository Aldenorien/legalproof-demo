// src/proof.controller.ts
import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { AgeProofService } from './age-proof.service';

@Controller('proof')
export class ProofController {
  constructor(private readonly ageProofService: AgeProofService) {}

  /**
   * GET /proof/status?wallet_pubkey=...
   *
   * Retourne le statut de la preuve AGE_18_PLUS pour ce wallet :
   * {
   *   wallet_pubkey: string;
   *   has_proof: boolean;
   *   is_major: boolean;
   *   revoked: boolean;
   *   valid_from: number | null;
   *   valid_until: number | null;
   *   deploy_hash: string | null;
   * }
   *
   * Remarque : aucune date de naissance ni information sensible
   * n’est renvoyée ici, seulement un statut agrégé.
   */
  @Get('status')
  async getStatus(@Query('wallet_pubkey') walletPubkey: string) {
    if (!walletPubkey || !walletPubkey.trim()) {
      throw new BadRequestException('wallet_pubkey est requis');
    }

    return this.ageProofService.getAge18PlusStatus(walletPubkey.trim());
  }

  /**
   * POST /proof/revoke
   *
   * Body JSON:
   * {
   *   "wallet_pubkey": "01abc...",
   *   "claim_type": "AGE_18_PLUS"   // optionnel, par défaut AGE_18_PLUS
   * }
   *
   * Révoque la dernière preuve AGE_18_PLUS active pour ce wallet
   * (appel du contrat Casper + mise à jour en base).
   *
   * La réponse suit la forme :
   * {
   *   wallet_pubkey: string;
   *   claim_type: string;
   *   had_proof: boolean;
   *   revoked: boolean;
   *   deploy_hash: string | null;
   *   valid_from: number | null;
   *   valid_until: number | null;
   * }
   *
   * Aucun détail de DOB n’est exposé.
   */
  @Post('revoke')
  async revokeProof(
    @Body('wallet_pubkey') walletPubkey: string,
    @Body('claim_type') claimType?: string,
  ) {
    if (!walletPubkey || !walletPubkey.trim()) {
      throw new BadRequestException('wallet_pubkey est requis');
    }

    const ct = (claimType ?? 'AGE_18_PLUS').trim();
    if (ct !== 'AGE_18_PLUS') {
      throw new BadRequestException(
        `claim_type non supporté pour l’instant: ${ct}`,
      );
    }

    return this.ageProofService.revokeAge18PlusClaim(walletPubkey.trim());
  }
}
