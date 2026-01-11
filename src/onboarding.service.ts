import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SessionEntity } from './entities/session.entity';
import { AgeProofService, BirthDate, CreateClaimResult } from './age-proof.service';

@Injectable()
export class OnboardingService {
  constructor(
    @InjectRepository(SessionEntity)
    private readonly sessionRepo: Repository<SessionEntity>,
    private readonly ageProofService: AgeProofService,
  ) {}

  /**
   * Démarre une session d’onboarding pour un wallet donné.
   * redirect_url est optionnel (mais recommandé).
   */
  async initOnboarding(wallet_pubkey: string, redirect_url?: string | null): Promise<{
    sessionId: string;
    fcUrl?: string;
  }> {
    const session = this.sessionRepo.create({
      wallet_pubkey,
      redirect_url: redirect_url?.trim() ? redirect_url.trim() : null,
      status: 'pending_mock_fc',
    });

    const saved = await this.sessionRepo.save(session);

    // Optionnel: renvoyer une URL directe vers le mock FC (utile UI)
    const publicApiBase = process.env.PUBLIC_API_BASE_URL?.trim() || '';
    const fcUrl = publicApiBase
      ? `${publicApiBase.replace(/\/+$/g, '')}/onboarding/mock-fc?sessionId=${encodeURIComponent(saved.id)}`
      : undefined;

    return { sessionId: saved.id, fcUrl };
  }

  /**
   * Gère le retour de la page mock FranceConnect.
   * OFF-CHAIN: crée/renseigne la preuve en DB uniquement.
   */
  async handleMockFcCallback(params: {
    sessionId: string;
    day: number;
    month: number;
    year: number;
  }): Promise<{
    sessionId: string;
    status: string;
    isMajor: boolean;
    claimCreated: boolean;
    deployHash: string | null;
    claimDetails: CreateClaimResult;
    redirectUrl: string | null;
    walletPubkey: string;
  }> {
    const { sessionId, day, month, year } = params;

    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');

    const birthDate: BirthDate = { day, month, year };

    const claimResult = await this.ageProofService.createAge18PlusClaimIfMajor(
      session.wallet_pubkey,
      birthDate,
      2,
      session.id,
    );

    session.status = claimResult.isMajor ? 'age_verified' : 'age_rejected';
    await this.sessionRepo.save(session);

    return {
      sessionId: session.id,
      status: session.status,
      isMajor: claimResult.isMajor,
      claimCreated: claimResult.claimCreated,
      deployHash: claimResult.deployHash,
      claimDetails: claimResult,
      redirectUrl: session.redirect_url ?? null,
      walletPubkey: session.wallet_pubkey,
    };
  }
}
