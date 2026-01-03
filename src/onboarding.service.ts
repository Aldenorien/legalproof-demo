// src/onboarding.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SessionEntity } from './entities/session.entity';
import {
  AgeProofService,
  BirthDate,
  CreateClaimResult,
} from './age-proof.service';

@Injectable()
export class OnboardingService {
  constructor(
    @InjectRepository(SessionEntity)
    private readonly sessionRepo: Repository<SessionEntity>,
    private readonly ageProofService: AgeProofService,
  ) {}

  /**
   * Démarre une session d’onboarding pour un wallet donné.
   * Utilisé par POST /onboarding/init.
   */
  async initOnboarding(wallet_pubkey: string): Promise<{ sessionId: string }> {
    const session = this.sessionRepo.create({
      wallet_pubkey,
      status: 'pending_mock_fc',
    });

    const saved = await this.sessionRepo.save(session);
    return { sessionId: saved.id };
  }

  /**
   * Gère le retour de la page mock FranceConnect :
   * - récupère la session,
   * - calcule l’âge à partir de la date de naissance,
   * - appelle AgeProofService pour créer le claim si majeur,
   * - met à jour le statut de la session,
   * - renvoie un résumé au contrôleur.
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
  }> {
    const { sessionId, day, month, year } = params;

    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const birthDate: BirthDate = { day, month, year };

    // Appel métier central : calcul d’âge, user_hash, claim + déploiement Casper si majeur
    const claimResult = await this.ageProofService.createAge18PlusClaimIfMajor(
      session.wallet_pubkey,
      birthDate,
      2,
      session.id,
    );

    // Mise à jour du statut de la session
    session.status = claimResult.isMajor ? 'age_verified' : 'age_rejected';
    await this.sessionRepo.save(session);

    return {
      sessionId: session.id,
      status: session.status,
      isMajor: claimResult.isMajor,
      claimCreated: claimResult.claimCreated,
      deployHash: claimResult.deployHash,
      claimDetails: claimResult,
    };
  }
}
