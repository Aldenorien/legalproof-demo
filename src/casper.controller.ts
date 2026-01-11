// src/casper.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CasperSubmissionEntity } from './entities/casper-submission.entity';

function extractVersion1Hash(maybeHash: any): string | null {
  if (!maybeHash) return null;
  if (typeof maybeHash === 'string') return maybeHash;
  if (typeof maybeHash === 'object' && typeof maybeHash.Version1 === 'string') return maybeHash.Version1;
  return null;
}

@Controller()
export class CasperController {
  constructor(
    @InjectRepository(CasperSubmissionEntity)
    private readonly casperSubRepo: Repository<CasperSubmissionEntity>,
  ) {}

  private getNodeRpcUrl(): string {
    return process.env.CASPER_NODE_RPC_URL || 'https://node.testnet.casper.network/rpc';
  }

  @Get('casper/health')
  async health() {
    return { ok: true, node_url: this.getNodeRpcUrl() };
  }

  /**
   * GET /casper/tx-status?hash=<Version1Hash>&finalized_approvals=true|false
   */
  @Get('casper/tx-status')
  async getTxStatus(
    @Query('hash') hash: string,
    @Query('finalized_approvals') finalizedApprovals?: string,
  ) {
    const txHash = (hash || '').trim();
    if (!txHash) throw new BadRequestException('hash requis');

    const nodeUrl = this.getNodeRpcUrl();
    const wantFinal = (finalizedApprovals || '').trim().toLowerCase() === 'true';

    // Spec Casper: info_get_transaction params name/value. :contentReference[oaicite:1]{index=1}
    const rpcReq = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'info_get_transaction',
      params: [
        { name: 'transaction_hash', value: { Version1: txHash } },
        { name: 'finalized_approvals', value: wantFinal },
      ],
    };

    const resp = await fetch(nodeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rpcReq),
    });

    const json = await resp.json().catch(() => null);

    if (!resp.ok || json?.error) {
      throw new BadRequestException({
        rpc_error: json?.error ?? json,
        node_url: nodeUrl,
        sent: rpcReq,
      });
    }

    return { node_url: nodeUrl, result: json.result };
  }

  /**
   * POST /sendDeploy
   * Corps:
   * - { transaction: <Transaction JSON>, meta?: {...} }
   *
   * RPC: account_put_transaction
   * Retour: { node_url, hash, result }
   */
  @Post('sendDeploy')
  async sendDeploy(@Body() body: any) {
    const nodeUrl = this.getNodeRpcUrl();

    const transaction = body?.transaction;
    const meta = body?.meta ?? null;

    if (!transaction || typeof transaction !== 'object') {
      throw new BadRequestException('Body invalide: { transaction: <object> } requis');
    }

    const rpcReq = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'account_put_transaction',
      // Sur ta config, le node accepte params sous forme “map avec une seule clé” (transaction) — et ça marche.
      params: { transaction },
    };

    const resp = await fetch(nodeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rpcReq),
    });

    const json = await resp.json().catch(() => null);

    if (!resp.ok || json?.error) {
      // Log DB best effort
      try {
        await this.casperSubRepo.save({
          wallet_pubkey: meta?.wallet_pubkey ?? null,
          chain_name: meta?.chain_name ?? null,
          rpc_method: 'account_put_transaction',
          hash: null,
          meta,
          payload: transaction,
          node_result: null,
          node_error: json?.error ?? json,
        });
      } catch {
        // ignore
      }

      throw new BadRequestException({
        rpc_error: json?.error ?? json,
        node_url: nodeUrl,
        sent: rpcReq,
      });
    }

    const txHashObj = json?.result?.transaction_hash;
    const hash = extractVersion1Hash(txHashObj);

    // Log DB best effort
    try {
      await this.casperSubRepo.save({
        wallet_pubkey: meta?.wallet_pubkey ?? null,
        chain_name: meta?.chain_name ?? null,
        rpc_method: 'account_put_transaction',
        hash,
        meta,
        payload: transaction,
        node_result: json?.result ?? null,
        node_error: null,
      });
    } catch {
      // ignore
    }

    // Retour “simple” + résultat brut
    return {
      node_url: nodeUrl,
      hash,
      result: json.result,
    };
  }
}
