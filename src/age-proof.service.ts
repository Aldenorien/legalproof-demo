// src/age-proof.service.ts
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgeProofEntity } from './entities/age-proof.entity';

const execFileAsync = promisify(execFile);

export interface BirthDate {
  day: number;   // 1–31
  month: number; // 1–12
  year: number;  // ex: 1985
}

export interface AgeComputationResult {
  age: number;
  isMajor: boolean;
}

export interface Age18PlusClaimParams {
  user_hash: string;
  claim_type: string;
  value: boolean;
  valid_from: number;  // timestamp Unix (secondes)
  valid_until: number; // timestamp Unix (secondes)
  revoked: boolean;
}

export interface CreateClaimResult {
  isMajor: boolean;
  claimCreated: boolean;
  deployHash: string | null;
  claimParams: Age18PlusClaimParams;
}

@Injectable()
export class AgeProofService {
  constructor(
    @InjectRepository(AgeProofEntity)
    private readonly ageProofRepo: Repository<AgeProofEntity>,
  ) {}

  /**
   * Salt utilisé pour rendre user_hash non trivial à deviner.
   */
  private getUserHashSalt(): string {
    return process.env.USER_HASH_SALT || 'legalproof_v1_default_salt';
  }

  /**
   * Calcule un identifiant pseudonyme stable (user_hash) à partir de la
   * wallet_pubkey de l’utilisateur.
   *
   * - Même wallet_pubkey → même user_hash.
   * - SHA-256 + salt (non réversible en pratique).
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
   * Calcule l’âge à partir d’une date de naissance et d’une date de référence.
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

    if (hasNotHadBirthdayThisYear) {
      age -= 1;
    }

    return {
      age,
      isMajor: age >= 18,
    };
  }

  /**
   * Construit les paramètres pour un claim AGE_18_PLUS à partir
   * d’une wallet_pubkey et d’une date de naissance.
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
      claim_type: 'AGE_18_PLUS',
      value: isMajor,
      valid_from: validFromSec,
      valid_until: validUntilSec,
      revoked: false,
    };
  }

  /**
   * Appelle `casper-client` pour envoyer register_or_update_claim
   * sur le contrat LegalProof Age (TestNet).
   */
  private async sendClaimToCasper(
    params: Age18PlusClaimParams,
  ): Promise<string> {
    const nodeAddress =
      process.env.CASPER_NODE_ADDRESS ||
      'https://node.testnet.casper.network';
    const chainName = process.env.CASPER_CHAIN_NAME || 'casper-test';
    const secretKeyPath =
      process.env.CASPER_DEV_SECRET_KEY ||
      '/home/adrien/casper-keys/dev/secret_key.pem';

    const contractHash =
      process.env.CASPER_CONTRACT_HASH ||
      'hash-d4c19e4794a71e3e303bd98929ab9980c1c89f6af6cba28580ec46346da0975a';

    const paymentAmount =
      process.env.CASPER_PAYMENT_AMOUNT || '5000000000';

    const args = [
      'put-deploy',
      '--node-address',
      nodeAddress,
      '--chain-name',
      chainName,
      '--secret-key',
      secretKeyPath,
      '--payment-amount',
      paymentAmount,
      '--session-hash',
      contractHash,
      '--session-entry-point',
      'register_or_update_claim',
      '--session-arg',
      `user_hash:string='${params.user_hash}'`,
      '--session-arg',
      `claim_type:string='${params.claim_type}'`,
      '--session-arg',
      `value:bool='${params.value ? 'true' : 'false'}'`,
      '--session-arg',
      `valid_from:u64='${params.valid_from}'`,
      '--session-arg',
      `valid_until:u64='${params.valid_until}'`,
      '--session-arg',
      `revoked:bool='${params.revoked ? 'true' : 'false'}'`,
    ];

    try {
      const { stdout, stderr } = await execFileAsync('casper-client', args);

      if (stderr && stderr.trim().length > 0) {
        // Log technique serveur uniquement
        // eslint-disable-next-line no-console
        console.error('[Casper STDERR][register_or_update_claim]', stderr);
      }

      const rawOut = stdout.trim();
      const firstBraceIndex = rawOut.indexOf('{');
      if (firstBraceIndex === -1) {
        // eslint-disable-next-line no-console
        console.error(
          '[Casper] Réponse stdout sans JSON valide (register_or_update_claim)',
          rawOut,
        );
        throw new Error('CASPER_NO_JSON');
      }

      const jsonPart = rawOut.slice(firstBraceIndex);

      let parsed: any;
      try {
        parsed = JSON.parse(jsonPart);
      } catch (_e) {
        // eslint-disable-next-line no-console
        console.error(
          '[Casper] Erreur de parsing JSON stdout (register_or_update_claim)',
          '\nSTDOUT brut:',
          rawOut,
        );
        throw new Error('CASPER_INVALID_JSON');
      }

      if (parsed.error) {
        // eslint-disable-next-line no-console
        console.error(
          '[Casper] Erreur côté casper-client (champ error présent)',
          parsed.error,
        );
        throw new Error('CASPER_JSON_ERROR_FIELD');
      }

      const deployHash = parsed.result?.deploy_hash;
      if (!deployHash) {
        // eslint-disable-next-line no-console
        console.error(
          '[Casper] deploy_hash manquant dans la réponse JSON (register_or_update_claim)',
          parsed,
        );
        throw new Error('CASPER_MISSING_DEPLOY_HASH');
      }

      // eslint-disable-next-line no-console
      console.log(
        '[Casper] Claim AGE_18_PLUS envoyé, deploy_hash =',
        deployHash,
      );

      return deployHash;
    } catch (err: any) {
      // Log très détaillé côté serveur
      // eslint-disable-next-line no-console
      console.error(
        '[Casper EXEC ERROR][register_or_update_claim]',
        err?.message || String(err),
        err?.stderr ? `\nSTDERR: ${err.stderr}` : '',
        '\nArgs:',
        args,
      );

      // Mais message générique côté client (pas d’err.message)
      throw new InternalServerErrorException(
        'Erreur lors de l’envoi du claim à Casper (code: CASPER_REGISTER_OR_UPDATE_FAILED)',
      );
    }
  }

  /**
   * API interne haut niveau :
   * - calcule l’âge,
   * - construit les paramètres de claim,
   * - si majeur → envoie sur Casper,
   * - si mineur → ne crée pas de claim.
   */
  async createAge18PlusClaimIfMajor(
    walletPubkey: string,
    birthDate: BirthDate,
    validityYears = 2,
    sessionId?: string,
  ): Promise<CreateClaimResult> {
    const ageResult = this.computeAge(birthDate);

    const shortWallet =
      walletPubkey.length > 16
        ? `${walletPubkey.slice(0, 10)}…${walletPubkey.slice(-6)}`
        : walletPubkey;

    // eslint-disable-next-line no-console
    console.log(
      '[AgeProof] Age calculé =',
      ageResult.age,
      'isMajor =',
      ageResult.isMajor,
      'pour wallet',
      shortWallet,
    );

    const claimParams = this.buildAge18PlusClaimParams(
      walletPubkey,
      birthDate,
      validityYears,
    );

    const validFromDate = new Date(claimParams.valid_from * 1000);
    const validUntilDate = new Date(claimParams.valid_until * 1000);

    if (!ageResult.isMajor) {
      await this.ageProofRepo.save({
        session_id: sessionId ?? null,
        wallet_pubkey: walletPubkey,
        user_hash: claimParams.user_hash,
        claim_type: claimParams.claim_type,
        age: ageResult.age,
        is_major: false,
        valid_from: validFromDate,
        valid_until: validUntilDate,
        revoked: claimParams.revoked,
        deploy_hash: null,
      });

      return {
        isMajor: false,
        claimCreated: false,
        deployHash: null,
        claimParams,
      };
    }

    const deployHash = await this.sendClaimToCasper(claimParams);

    await this.ageProofRepo.save({
      session_id: sessionId ?? null,
      wallet_pubkey: walletPubkey,
      user_hash: claimParams.user_hash,
      claim_type: claimParams.claim_type,
      age: ageResult.age,
      is_major: true,
      valid_from: validFromDate,
      valid_until: validUntilDate,
      revoked: claimParams.revoked,
      deploy_hash: deployHash,
    });

    return {
      isMajor: true,
      claimCreated: true,
      deployHash,
      claimParams,
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
    const now = Math.floor(Date.now() / 1000);

    const proof = await this.ageProofRepo.findOne({
      where: {
        wallet_pubkey: walletPubkey,
        claim_type: 'AGE_18_PLUS',
      },
      order: {
        created_at: 'DESC',
      },
    });

    if (!proof) {
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

    const validFromTs = proof.valid_from
      ? Math.floor(proof.valid_from.getTime() / 1000)
      : null;
    const validUntilTs = proof.valid_until
      ? Math.floor(proof.valid_until.getTime() / 1000)
      : null;

    const isCurrentlyValid =
      proof.is_major &&
      !proof.revoked &&
      validFromTs !== null &&
      validUntilTs !== null &&
      validFromTs <= now &&
      validUntilTs >= now;

    return {
      wallet_pubkey: walletPubkey,
      has_proof: true,
      is_major: isCurrentlyValid,
      revoked: proof.revoked,
      valid_from: validFromTs,
      valid_until: validUntilTs,
      deploy_hash: proof.deploy_hash,
    };
  }

  // ---------------------------------------------------------------------------
  //  RÉVOCATION D’UNE PREUVE AGE_18_PLUS
  // ---------------------------------------------------------------------------

  /**
   * Appel spécifique au contrat Casper pour révoquer un claim
   * via l'entrypoint `revoke_claim`.
   */
  private async sendRevokeToCasper(user_hash: string, claim_type: string) {
    const nodeAddress =
      process.env.CASPER_NODE_ADDRESS ||
      'https://node.testnet.casper.network';
    const chainName = process.env.CASPER_CHAIN_NAME || 'casper-test';
    const secretKeyPath =
      process.env.CASPER_DEV_SECRET_KEY ||
      '/home/adrien/casper-keys/dev/secret_key.pem';

    const contractHash =
      process.env.CASPER_CONTRACT_HASH ||
      'hash-d4c19e4794a71e3e303bd98929ab9980c1c89f6af6cba28580ec46346da0975a';

    const paymentAmount =
      process.env.CASPER_PAYMENT_AMOUNT || '5000000000';

    const args = [
      'put-deploy',
      '--node-address',
      nodeAddress,
      '--chain-name',
      chainName,
      '--secret-key',
      secretKeyPath,
      '--payment-amount',
      paymentAmount,
      '--session-hash',
      contractHash,
      '--session-entry-point',
      'revoke_claim',
      '--session-arg',
      `user_hash:string='${user_hash}'`,
      '--session-arg',
      `claim_type:string='${claim_type}'`,
    ];

    try {
      const { stdout, stderr } = await execFileAsync('casper-client', args);

      if (stderr && stderr.trim().length > 0) {
        // eslint-disable-next-line no-console
        console.error('[Casper STDERR][revoke_claim]', stderr);
      }

      const rawOut = stdout.trim();
      const firstBraceIndex = rawOut.indexOf('{');
      if (firstBraceIndex === -1) {
        // eslint-disable-next-line no-console
        console.error(
          '[Casper] Réponse stdout sans JSON valide (revoke_claim)',
          rawOut,
        );
        throw new Error('CASPER_NO_JSON');
      }

      const jsonPart = rawOut.slice(firstBraceIndex);

      let parsed: any;
      try {
        parsed = JSON.parse(jsonPart);
      } catch (_e) {
        // eslint-disable-next-line no-console
        console.error(
          '[Casper] Erreur de parsing JSON stdout (revoke_claim)',
          '\nSTDOUT brut:',
          rawOut,
        );
        throw new Error('CASPER_INVALID_JSON');
      }

      if (parsed.error) {
        // eslint-disable-next-line no-console
        console.error(
          '[Casper] Erreur côté casper-client (error) sur revoke_claim',
          parsed.error,
        );
        throw new Error('CASPER_JSON_ERROR_FIELD');
      }

      const deployHash = parsed.result?.deploy_hash;
      if (!deployHash) {
        // eslint-disable-next-line no-console
        console.error(
          '[Casper] deploy_hash manquant dans la réponse (revoke_claim)',
          parsed,
        );
        throw new Error('CASPER_MISSING_DEPLOY_HASH');
      }

      // eslint-disable-next-line no-console
      console.log(
        '[Casper] Révocation AGE_18_PLUS envoyée, deploy_hash =',
        deployHash,
      );

      return deployHash;
    } catch (err: any) {
      // Log très détaillé côté serveur
      // eslint-disable-next-line no-console
      console.error(
        '[Casper EXEC ERROR][revoke_claim]',
        err?.message || String(err),
        err?.stderr ? `\nSTDERR: ${err.stderr}` : '',
        '\nArgs:',
        args,
      );

      // Mais message générique côté client
      throw new InternalServerErrorException(
        'Erreur lors de la révocation du claim sur Casper (code: CASPER_REVOKE_FAILED)',
      );
    }
  }

  /**
   * Révoque la dernière preuve AGE_18_PLUS active pour un wallet donné :
   * - calcule user_hash,
   * - trouve le dernier enregistrement non révoqué,
   * - appelle revoke_claim sur Casper,
   * - met à jour la ligne en base (revoked = true).
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
    const claim_type = 'AGE_18_PLUS';
    const user_hash = this.computeUserHash(walletPubkey);

    const proof = await this.ageProofRepo.findOne({
      where: {
        wallet_pubkey: walletPubkey,
        claim_type,
      },
      order: {
        created_at: 'DESC',
      },
    });

    if (!proof) {
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

    if (proof.revoked) {
      const vf = proof.valid_from
        ? Math.floor(proof.valid_from.getTime() / 1000)
        : null;
      const vu = proof.valid_until
        ? Math.floor(proof.valid_until.getTime() / 1000)
        : null;

      return {
        wallet_pubkey: walletPubkey,
        claim_type,
        had_proof: true,
        revoked: true,
        deploy_hash: proof.deploy_hash,
        valid_from: vf,
        valid_until: vu,
      };
    }

    const revokeDeployHash = await this.sendRevokeToCasper(
      user_hash,
      claim_type,
    );

    proof.revoked = true;
    proof.deploy_hash = revokeDeployHash;
    await this.ageProofRepo.save(proof);

    const vf = proof.valid_from
      ? Math.floor(proof.valid_from.getTime() / 1000)
      : null;
    const vu = proof.valid_until
      ? Math.floor(proof.valid_until.getTime() / 1000)
      : null;

    return {
      wallet_pubkey: walletPubkey,
      claim_type,
      had_proof: true,
      revoked: true,
      deploy_hash: revokeDeployHash,
      valid_from: vf,
      valid_until: vu,
    };
  }
}
