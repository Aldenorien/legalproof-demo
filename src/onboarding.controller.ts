// src/onboarding.controller.ts
import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Query,
  BadRequestException,
  Res,
  Req,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response, Request } from 'express';

import { OnboardingService } from './onboarding.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  /**
   * POST /onboarding/init
   *
   * Protégé par JWT:
   * - Authorization: Bearer <token>
   *
   * Body:
   * {
   *   "redirect_url": "https://legalproof.safoutan.com/verify" (optionnel)
   * }
   *
   * Le wallet_pubkey vient du token (req.user.wallet_pubkey).
   */
  @UseGuards(JwtAuthGuard)
  @Post('init')
  async init(
    @Req() req: Request & { user?: any },
    @Body() body: { redirect_url?: string },
  ) {
    const tokenWallet = (req.user?.wallet_pubkey || '').trim();
    if (!tokenWallet) {
      throw new UnauthorizedException('Invalid token payload (missing wallet_pubkey)');
    }

    const redirectUrl = body?.redirect_url?.trim() ? body.redirect_url.trim() : null;

    return this.onboardingService.initOnboarding(tokenWallet, redirectUrl);
  }

  /**
   * GET /onboarding/mock-fc?sessionId=...
   * Renvoie une page HTML sandbox simulant FranceConnect.
   */
  @Get('mock-fc')
  @Header('Content-Type', 'text/html')
  async mockFc(@Query('sessionId') sessionId?: string) {
    if (!sessionId || !sessionId.trim()) {
      throw new BadRequestException('sessionId is required');
    }

    const sid = sessionId.trim();
    if (!/^[0-9a-zA-Z_-]+$/.test(sid)) {
      throw new BadRequestException('sessionId has an invalid format');
    }

    return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <title>Mock FranceConnect - LegalProof</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
  <h1>Simulateur FranceConnect - Date de naissance (sandbox)</h1>
  <p>
    Cette page est une simulation pour LegalProof.
    La date de naissance sert uniquement à calculer "18+ / non" et n’est pas renvoyée au front.
  </p>
  <form method="GET" action="/onboarding/mock-fc/callback">
    <input type="hidden" name="sessionId" value="${sid}" />
    <label>
      Jour :
      <input type="number" name="day" min="1" max="31" required />
    </label>
    <br />
    <label>
      Mois :
      <input type="number" name="month" min="1" max="12" required />
    </label>
    <br />
    <label>
      Année :
      <input type="number" name="year" min="1900" max="2100" required />
    </label>
    <br /><br />
    <button type="submit">Valider</button>
  </form>
</body>
</html>
    `;
  }

  /**
   * GET /onboarding/mock-fc/callback
   *
   * Par défaut: si la session a un redirect_url => 302 vers le front.
   * Pour tests curl: ajoute ?format=json pour forcer le JSON.
   */
  @Get('mock-fc/callback')
  async mockFcCallback(
    @Query('sessionId') sessionId?: string,
    @Query('day') day?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (!sessionId || !day || !month || !year) {
      throw new BadRequestException('sessionId, day, month et year sont requis');
    }

    const sid = sessionId.trim();
    const dayNum = parseInt(day.trim(), 10);
    const monthNum = parseInt(month.trim(), 10);
    const yearNum = parseInt(year.trim(), 10);

    if (![dayNum, monthNum, yearNum].every(Number.isInteger)) {
      throw new BadRequestException('day, month et year doivent être des entiers');
    }
    if (dayNum < 1 || dayNum > 31) throw new BadRequestException('day doit être entre 1 et 31');
    if (monthNum < 1 || monthNum > 12) throw new BadRequestException('month doit être entre 1 et 12');
    if (yearNum < 1900 || yearNum > 2100) throw new BadRequestException('year doit être entre 1900 et 2100');

    const result = await this.onboardingService.handleMockFcCallback({
      sessionId: sid,
      day: dayNum,
      month: monthNum,
      year: yearNum,
    });

    const wantJson = (format || '').toLowerCase() === 'json';

    if (!wantJson && result.redirectUrl) {
      try {
        const u = new URL(result.redirectUrl);

        // On n’envoie pas la DOB au front. On envoie seulement un résultat.
        u.searchParams.set('sessionId', result.sessionId);
        u.searchParams.set('status', result.status);
        u.searchParams.set('isMajor', String(result.isMajor));
        u.searchParams.set('wallet_pubkey', result.walletPubkey);
        u.searchParams.set('claimCreated', String(result.claimCreated));

        res?.redirect(302, u.toString());
        return;
      } catch {
        // redirect_url invalide => fallback JSON
      }
    }

    return result;
  }
}
