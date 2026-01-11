import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, createHash } from 'crypto';

import nacl from 'tweetnacl';
import * as secp from '@noble/secp256k1';

// --------------------
// DTOs (simples et pratiques)
// --------------------

export type ChallengeResponseDto = {
  challenge_id: string;
  wallet_pubkey: string;
  message_to_sign: string;
  expires_at: string; // ISO
};

export type VerifyRequestDto = {
  wallet_pubkey: string;
  challenge_id: string;
  signature_hex: string; // signature en hex (avec ou sans préfixe 0x)
};

export type VerifyResponseDto = {
  ok: boolean;
  wallet_pubkey: string;
  token: string; // JWT court
  expires_in_seconds: number;
};

// --------------------
// Structure interne de challenge (in-memory pour commencer)
// --------------------
type StoredChallenge = {
  walletPubkey: string;
  messageToSign: string;
  expiresAtMs: number;
};

@Injectable()
export class AuthService {
  private readonly challenges = new Map<string, StoredChallenge>();

  private readonly CHALLENGE_TTL_MS = 5 * 60 * 1000;
  private readonly JWT_EXPIRES_IN_SECONDS = 5 * 60;

  constructor(private readonly jwtService: JwtService) {}

  async createChallenge(walletPubkeyRaw: string): Promise<ChallengeResponseDto> {
    const wallet_pubkey = (walletPubkeyRaw || '').trim();
    this.assertPubkeyFormat(wallet_pubkey);

    const challenge_id = this.randomHex(16); // 32 hex chars
    const nonce = this.randomHex(32);        // 64 hex chars
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + this.CHALLENGE_TTL_MS).toISOString();

    // IMPORTANT : message stable, sans retour ligne ambigus.
    // Casper Wallet ajoutera de son côté un préfixe "Casper Message:\n" lors du signMessage.
    const message_to_sign =
      `LegalProof|auth|wallet_pubkey=${wallet_pubkey}` +
      `|nonce=${nonce}` +
      `|issued_at=${issuedAt}` +
      `|purpose=prove_wallet_ownership`;

    this.challenges.set(challenge_id, {
      walletPubkey: wallet_pubkey,
      messageToSign: message_to_sign,
      expiresAtMs: Date.now() + this.CHALLENGE_TTL_MS,
    });

    return {
      challenge_id,
      wallet_pubkey,
      message_to_sign,
      expires_at: expiresAt,
    };
  }

  async verifySignatureAndIssueToken(body: VerifyRequestDto): Promise<VerifyResponseDto> {
    const wallet_pubkey = (body.wallet_pubkey || '').trim();
    const challenge_id = (body.challenge_id || '').trim();
    const signature_hex = (body.signature_hex || '').trim();

    this.assertPubkeyFormat(wallet_pubkey);

    const stored = this.challenges.get(challenge_id);
    if (!stored) {
      throw new UnauthorizedException('Unknown or expired challenge_id');
    }
    if (stored.walletPubkey !== wallet_pubkey) {
      throw new UnauthorizedException('Challenge does not match wallet_pubkey');
    }
    if (Date.now() > stored.expiresAtMs) {
      this.challenges.delete(challenge_id);
      throw new UnauthorizedException('Challenge expired');
    }

    const ok = this.verifyCasperSignature(wallet_pubkey, stored.messageToSign, signature_hex);
    if (!ok) {
      throw new UnauthorizedException('Invalid signature');
    }

    // anti-replay
    this.challenges.delete(challenge_id);

    const payload = {
      sub: wallet_pubkey,
      wallet_pubkey,
      scope: ['proof:create', 'proof:revoke'],
    };

    const token = await this.jwtService.signAsync(payload, {
      expiresIn: this.JWT_EXPIRES_IN_SECONDS,
    });

    return {
      ok: true,
      wallet_pubkey,
      token,
      expires_in_seconds: this.JWT_EXPIRES_IN_SECONDS,
    };
  }

  // --------------------
  // Vérification de signature Casper
  // --------------------

  private verifyCasperSignature(walletPubkeyHex: string, message: string, signatureHex: string): boolean {
    const keyTag = walletPubkeyHex.slice(0, 2).toLowerCase();

    // Casper Wallet (extension) signe en pratique : "Casper Message:\n" + message
    // On supporte aussi le cas "message brut" pour compatibilité.
    const candidateMessages: Uint8Array[] = [
      new TextEncoder().encode(`Casper Message:\n${message}`),
      new TextEncoder().encode(message),
    ];

    if (keyTag === '01') {
      const pubKeyBytes = this.hexToBytes(walletPubkeyHex.slice(2)); // 32 bytes
      const sigBytes = this.normalizeSignatureBytes(signatureHex, 'ed25519');

      for (const msgBytes of candidateMessages) {
        if (nacl.sign.detached.verify(msgBytes, sigBytes, pubKeyBytes)) {
          return true;
        }
      }
      return false;
    }

    if (keyTag === '02') {
      const pubKeyBytes = this.hexToBytes(walletPubkeyHex.slice(2)); // 33 bytes compressé
      const sigBytes = this.normalizeSignatureBytes(signatureHex, 'secp256k1');
      const sig64 = sigBytes.length === 65 ? sigBytes.slice(0, 64) : sigBytes;

      for (const msgBytes of candidateMessages) {
        const msgHash = createHash('sha256').update(msgBytes).digest();
        if (secp.verify(sig64, msgHash, pubKeyBytes)) {
          return true;
        }
      }
      return false;
    }

    throw new BadRequestException('Unsupported Casper key algorithm (expected 01 or 02 prefix)');
  }

  private normalizeSignatureBytes(signatureHex: string, alg: 'ed25519' | 'secp256k1'): Uint8Array {
    const hex = signatureHex.toLowerCase().replace(/^0x/, '');
    const bytes = this.hexToBytes(hex);

    if (alg === 'ed25519') {
      if (bytes.length === 64) return bytes;
      if (bytes.length === 65) return bytes.slice(1);
      throw new BadRequestException(`Unexpected ed25519 signature length: ${bytes.length} bytes`);
    }

    if (bytes.length === 64 || bytes.length === 65) return bytes;
    throw new BadRequestException(`Unexpected secp256k1 signature length: ${bytes.length} bytes`);
  }

  private assertPubkeyFormat(walletPubkeyHex: string) {
    const hex = walletPubkeyHex.toLowerCase().replace(/^0x/, '');

    if (!/^[0-9a-f]+$/.test(hex)) {
      throw new BadRequestException('wallet_pubkey must be hex');
    }
    if (!(hex.startsWith('01') || hex.startsWith('02'))) {
      throw new BadRequestException('wallet_pubkey must start with 01 (Ed25519) or 02 (Secp256k1)');
    }

    if (hex.startsWith('01') && hex.length !== 66) {
      throw new BadRequestException(`Ed25519 pubkey must be 66 hex chars, got ${hex.length}`);
    }
    if (hex.startsWith('02') && hex.length !== 68) {
      throw new BadRequestException(`Secp256k1 pubkey must be 68 hex chars, got ${hex.length}`);
    }
  }

  private randomHex(nBytes: number): string {
    return randomBytes(nBytes).toString('hex');
  }

  private hexToBytes(hex: string): Uint8Array {
    if (hex.length % 2 !== 0) throw new BadRequestException('Invalid hex length');
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
}
