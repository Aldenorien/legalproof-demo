// src/onboarding.controller.ts
import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { OnboardingService } from './onboarding.service';

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  /**
   * POST /onboarding/init
   *
   * Body:
   * {
   *   "wallet_pubkey": "01e4ef..."
   * }
   *
   * Réponse:
   * {
   *   "sessionId": "..."
   * }
   */
  @Post('init')
  async init(@Body() body: { wallet_pubkey: string }) {
    if (!body?.wallet_pubkey || !body.wallet_pubkey.trim()) {
      throw new BadRequestException('wallet_pubkey is required');
    }

    const wallet = body.wallet_pubkey.trim();
    return this.onboardingService.initOnboarding(wallet);
  }

  /**
   * GET /onboarding/mock-fc?sessionId=...
   *
   * Renvoie une page HTML sandbox simulant FranceConnect
   * avec un formulaire jour / mois / année.
   * Aucune donnée n’est stockée ici : tout part en query vers le callback.
   */
  @Get('mock-fc')
  @Header('Content-Type', 'text/html')
  async mockFc(@Query('sessionId') sessionId?: string) {
    if (!sessionId || !sessionId.trim()) {
      throw new BadRequestException('sessionId is required');
    }

    const sid = sessionId.trim();

    // petite validation pour éviter des caractères exotiques dans l’HTML
    if (!/^[0-9a-zA-Z_-]+$/.test(sid)) {
      throw new BadRequestException('sessionId has an invalid format');
    }

    // Page HTML simple simulant FranceConnect : formulaire jour/mois/année
    return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <title>Mock FranceConnect - LegalProof</title>
</head>
<body>
  <h1>Simulateur FranceConnect - Date de naissance (sandbox)</h1>
  <p>Cette page est une simulation pour LegalProof. Les données ne sont utilisées que pour calculer un âge et ne sont pas renvoyées au frontend.</p>
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
    <br />
    <button type="submit">Valider</button>
  </form>
</body>
</html>
    `;
  }

  /**
   * GET /onboarding/mock-fc/callback
   *
   * Reçoit sessionId + jour/mois/année depuis la page mock FC,
   * appelle la logique métier (AgeProofService) et renvoie un JSON de résultat.
   */
  @Get('mock-fc/callback')
  async mockFcCallback(
    @Query('sessionId') sessionId?: string,
    @Query('day') day?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    if (!sessionId || !day || !month || !year) {
      throw new BadRequestException(
        'sessionId, day, month et year sont requis',
      );
    }

    const sid = sessionId.trim();
    const dayStr = day.trim();
    const monthStr = month.trim();
    const yearStr = year.trim();

    const dayNum = parseInt(dayStr, 10);
    const monthNum = parseInt(monthStr, 10);
    const yearNum = parseInt(yearStr, 10);

    if (
      !Number.isInteger(dayNum) ||
      !Number.isInteger(monthNum) ||
      !Number.isInteger(yearNum)
    ) {
      throw new BadRequestException(
        'day, month et year doivent être des entiers',
      );
    }

    if (dayNum < 1 || dayNum > 31) {
      throw new BadRequestException('day doit être entre 1 et 31');
    }
    if (monthNum < 1 || monthNum > 12) {
      throw new BadRequestException('month doit être entre 1 et 12');
    }
    if (yearNum < 1900 || yearNum > 2100) {
      throw new BadRequestException('year doit être entre 1900 et 2100');
    }

    const result = await this.onboardingService.handleMockFcCallback({
      sessionId: sid,
      day: dayNum,
      month: monthNum,
      year: yearNum,
    });

    // JSON de résultat (très pratique pour les tests / la démo)
    return result;
  }
}
