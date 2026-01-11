// src/age-proof.service.ts
import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AgeProofEntity } from './entities/age-proof.entity';

export interface BirthDate {
  day: number; // 1–31
  month: number; // 1–12
  year: number; // ex: 1985
}

export interface AgeComputationResult {
  age: number;
  isMajor: boolean;
}

export interface Age18PlusClaimParams {
  user_hash: string;
  claim_type: string;
  value: boolean;
  valid_from: number; // timestamp Unix (secondes)
  valid_until: number; // timestamp Unix (secondes)
  revoked: boolean;
}

export interface CreateClaimResult {
  isMajor: boolean;
  claimCreated: boolean;
  deployHash: string | null; // off-chain MVP: toujours null
  claimParams: Age18PlusClaimParams;
}

@Injectable()
export class AgeProofService {
  constructor(
    @InjectRepository(AgeProofEntity)
    private readonly ageProofRepo: Repository<AgeProofEntity>,
    private readonly dataSource: DataSource,
  ) {}

  private readonly CLAIM_TYPE = 'AGE_18_PLUS';

  /**
   * Salt utilisé pour rendre user_hash non trivial à deviner.
   */
  private getUserHashSalt(): string {
    return process.env.USER_HASH_SALT || 'legalproof_v1_default_salt';
  }

  /**
   * Identifiant pseudonyme stable (user_hash) à partir de wallet_pubkey.
   */
  computeUserHash(walletPubkey: string): string {
    const salt = this.getUserHashSalt();

    return createHash('sha256')
      .update(walletPubkey.trim())
      .update(':')
      .update(salt)
      .digest('hex');
  }

  /**
   * Calcule l’âge à partir d’une date de naissance.
   */
  computeAge(
    birthDate: BirthDate,
    referenceDate: Date = new Date(),
  ): AgeComputationResult {
    const { day, month, year } = birthDate;

    let age = referenceDate.getFullYear() - year;

    const hasNotHadBirthdayThisYear =
      referenceDate.getMonth() < month - 1 ||
      (referenceDate.getMonth() === month - 1 &&
        referenceDate.getDate() < day);

    if (hasNotHadBirthdayThisYear) age -= 1;

    return { age, isMajor: age >= 18 };
  }

  /**
   * Paramètres de claim AGE_18_PLUS (off-chain).
   */
  buildAge18PlusClaimParams(
    walletPubkey: string,
    birthDate: BirthDate,
    validityYears = 2,
    referenceDate: Date = new Date(),
  ): Age18PlusClaimParams {
    const user_hash = this.computeUserHash(walletPubkey);
    const { isMajor } = this.computeAge(birthDate, referenceDate);

    const validFromSec = Math.floor(referenceDate.getTime() / 1000);

    const validUntilDate = new Date(referenceDate);
    validUntilDate.setFullYear(validUntilDate.getFullYear() + validityYears);
    const validUntilSec = Math.floor(validUntilDate.getTime() / 1000);

    return {
      user_hash,
      claim_type: this.CLAIM_TYPE,
      value: isMajor,
      valid_from: validFromSec,
      valid_until: validUntilSec,
      revoked: false,
    };
  }

  /**
   * MVP OFF-CHAIN avec rotation:
   *
   * Si MAJEUR:
   *  - révoque toute preuve active précédente (revoked=false) pour (wallet_pubkey, claim_type)
   *  - crée une nouvelle preuve active (revoked=false)
   *  - le tout en transaction pour respecter l’index partiel ux_age_proofs_active
   *
   * Si MINEUR:
   *  - ne crée jamais de preuve active
   *  - optionnel: écrit une ligne “audit” déjà révoquée (revoked=true)
   *  - ne révoque jamais une preuve majeure existante
   */
  async createAge18PlusClaimIfMajor(
    walletPubkey: string,
    birthDate: BirthDate,
    validityYears = 2,
    sessionId?: string,
  ): Promise<CreateClaimResult> {
    const claimParamsBase = this.buildAge18PlusClaimParams(
      walletPubkey,
      birthDate,
      validityYears,
    );

    const validFromDate = new Date(claimParamsBase.valid_from * 1000);
    const validUntilDate = new Date(claimParamsBase.valid_until * 1000);

    const ageResult = this.computeAge(birthDate);
    const session_id = sessionId ?? null;

    // MINEUR -> jamais "active"
    if (!ageResult.isMajor) {
      // Audit (revoked=true) : garde une trace sans jamais être "active"
      await this.ageProofRepo.save({
        session_id,
        wallet_pubkey: walletPubkey,
        user_hash: claimParamsBase.user_hash,
        claim_type: claimParamsBase.claim_type,
        age: ageResult.age,
        is_major: false,
        valid_from: validFromDate,
        valid_until: validUntilDate,
        revoked: true, // IMPORTANT: jamais actif
        deploy_hash: null,
      });

      const claimParams: Age18PlusClaimParams = {
        ...claimParamsBase,
        revoked: true,
      };

      return {
        isMajor: false,
        claimCreated: false,
        deployHash: null,
        claimParams,
      };
    }

    // MAJEUR -> rotation atomique (révocation des actifs puis création d’un nouvel actif)
    await this.dataSource.transaction(async (manager) => {
      // (Optionnel mais utile) Lock des lignes "actives" pour limiter les collisions en concurrence
      await manager.query(
        `
        SELECT id
        FROM age_proofs
        WHERE wallet_pubkey = $1
          AND claim_type = $2
          AND revoked = false
        FOR UPDATE
        `,
        [walletPubkey, this.CLAIM_TYPE],
      );

      // 1) révoque l’actif précédent (s’il existe)
      await manager
        .createQueryBuilder()
        .update(AgeProofEntity)
        .set({ revoked: true })
        .where('wallet_pubkey = :wallet', { wallet: walletPubkey })
        .andWhere('claim_type = :ct', { ct: this.CLAIM_TYPE })
        .andWhere('revoked = false')
        .execute();

      // 2) crée le nouvel actif
      await manager.getRepository(AgeProofEntity).save({
        session_id,
        wallet_pubkey: walletPubkey,
        user_hash: claimParamsBase.user_hash,
        claim_type: claimParamsBase.claim_type,
        age: ageResult.age,
        is_major: true,
        valid_from: validFromDate,
        valid_until: validUntilDate,
        revoked: false,
        deploy_hash: null,
      });
    });

    return {
      isMajor: true,
      claimCreated: true,
      deployHash: null,
      claimParams: claimParamsBase,
    };
  }

  async getAge18PlusStatus(walletPubkey: string): Promise<{
    wallet_pubkey: string;
    has_proof: boolean;
    is_major: boolean;
    revoked: boolean;
    valid_from: number | null;
    valid_until: number | null;
    deploy_hash: string | null;
  }> {
    const now = new Date();

    // 1) On cherche d’abord une preuve actuellement valide (active + majeure + dans la fenêtre)
    const activeValid = await this.ageProofRepo.findOne({
      where: {
        wallet_pubkey: walletPubkey,
        claim_type: this.CLAIM_TYPE,
        revoked: false,
        is_major: true,
      },
      order: { created_at: 'DESC' },
    });

    // Remarque: on vérifie la fenêtre temporelle en JS (simple, portable)
    if (activeValid) {
      const validFromTs = activeValid.valid_from
        ? Math.floor(activeValid.valid_from.getTime() / 1000)
        : null;
      const validUntilTs = activeValid.valid_until
        ? Math.floor(activeValid.valid_until.getTime() / 1000)
        : null;

      const isCurrentlyValid =
        validFromTs !== null &&
        validUntilTs !== null &&
        activeValid.valid_from.getTime() <= now.getTime() &&
        activeValid.valid_until.getTime() >= now.getTime();

      if (isCurrentlyValid) {
        return {
          wallet_pubkey: walletPubkey,
          has_proof: true,
          is_major: true,
          revoked: false,
          valid_from: validFromTs,
          valid_until: validUntilTs,
          deploy_hash: activeValid.deploy_hash,
        };
      }
    }

    // 2) Sinon, on renvoie l’état “non valide” mais on garde la visibilité sur l’historique
    const latest = await this.ageProofRepo.findOne({
      where: { wallet_pubkey: walletPubkey, claim_type: this.CLAIM_TYPE },
      order: { created_at: 'DESC' },
    });

    if (!latest) {
      return {
        wallet_pubkey: walletPubkey,
        has_proof: false,
        is_major: false,
        revoked: false,
        valid_from: null,
        valid_until: null,
        deploy_hash: null,
      };
    }

    const vf = latest.valid_from
      ? Math.floor(latest.valid_from.getTime() / 1000)
      : null;
    const vu = latest.valid_until
      ? Math.floor(latest.valid_until.getTime() / 1000)
      : null;

    return {
      wallet_pubkey: walletPubkey,
      has_proof: true,
      is_major: false, // aucune preuve actuellement valide
      revoked: latest.revoked,
      valid_from: vf,
      valid_until: vu,
      deploy_hash: latest.deploy_hash,
    };
  }

  /**
   * MVP OFF-CHAIN:
   * Révocation = update DB uniquement.
   *
   * Important: on révoque la preuve ACTIVE (revoked=false).
   */
  async revokeAge18PlusClaim(walletPubkey: string): Promise<{
    wallet_pubkey: string;
    claim_type: string;
    had_proof: boolean;
    revoked: boolean;
    deploy_hash: string | null;
    valid_from: number | null;
    valid_until: number | null;
  }> {
    const claim_type = this.CLAIM_TYPE;

    // Preuve active (au plus 1 grâce à l’index partiel)
    const active = await this.ageProofRepo.findOne({
      where: { wallet_pubkey: walletPubkey, claim_type, revoked: false },
      order: { created_at: 'DESC' },
    });

    if (!active) {
      // Aucun actif; on regarde s’il y a de l’historique
      const latest = await this.ageProofRepo.findOne({
        where: { wallet_pubkey: walletPubkey, claim_type },
        order: { created_at: 'DESC' },
      });

      if (!latest) {
        return {
          wallet_pubkey: walletPubkey,
          claim_type,
          had_proof: false,
          revoked: false,
          deploy_hash: null,
          valid_from: null,
          valid_until: null,
        };
      }

      const vf = latest.valid_from
        ? Math.floor(latest.valid_from.getTime() / 1000)
        : null;
      const vu = latest.valid_until
        ? Math.floor(latest.valid_until.getTime() / 1000)
        : null;

      return {
        wallet_pubkey: walletPubkey,
        claim_type,
        had_proof: true,
        revoked: true, // “rien d’actif”
        deploy_hash: latest.deploy_hash,
        valid_from: vf,
        valid_until: vu,
      };
    }

    active.revoked = true;
    await this.ageProofRepo.save(active);

    const vf = active.valid_from
      ? Math.floor(active.valid_from.getTime() / 1000)
      : null;
    const vu = active.valid_until
      ? Math.floor(active.valid_until.getTime() / 1000)
      : null;

    return {
      wallet_pubkey: walletPubkey,
      claim_type,
      had_proof: true,
      revoked: true,
      deploy_hash: active.deploy_hash,
      valid_from: vf,
      valid_until: vu,
    };
  }
    /**
   * DEBUG/ADMIN: liste l’historique des proofs pour un wallet.
   * Important: renvoie aussi les entrées révoquées / mineures (audit).
   */
  async listAgeProofsForWallet(walletPubkey: string, take = 50): Promise<{
    wallet_pubkey: string;
    count: number;
    items: Array<{
      id: number;
      session_id: string | null;
      claim_type: string;
      age: number;
      is_major: boolean;
      revoked: boolean;
      valid_from: number | null;
      valid_until: number | null;
      deploy_hash: string | null;
      created_at: string;
      updated_at: string;
    }>;
  }> {
    const rows = await this.ageProofRepo.find({
      where: { wallet_pubkey: walletPubkey },
      order: { created_at: 'DESC' },
      take,
    });

    const items = rows.map((p) => ({
      id: p.id,
      session_id: p.session_id ?? null,
      claim_type: p.claim_type,
      age: p.age,
      is_major: p.is_major,
      revoked: p.revoked,
      valid_from: p.valid_from ? Math.floor(p.valid_from.getTime() / 1000) : null,
      valid_until: p.valid_until ? Math.floor(p.valid_until.getTime() / 1000) : null,
      deploy_hash: p.deploy_hash ?? null,
      created_at: p.created_at?.toISOString?.() ?? String(p.created_at),
      updated_at: p.updated_at?.toISOString?.() ?? String(p.updated_at),
    }));

    return {
      wallet_pubkey: walletPubkey,
      count: rows.length,
      items,
    };
  }

}
