import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DbService } from './db.service';

import { SessionEntity } from './entities/session.entity';
import { LogEntity } from './entities/log.entity';
import { AgeProofEntity } from './entities/age-proof.entity';
import { CasperSubmissionEntity } from './entities/casper-submission.entity';

import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

import { AgeProofService } from './age-proof.service';
import { ProofController } from './proof.controller';
import { ApiVerifyController } from './api-verify.controller';
import { AuthModule } from './auth/auth.module';
import { CasperController } from './casper.controller';
import { AdminController } from './admin.controller';
import { AdminEnvController } from './admin-env.controller';


@Module({
  imports: [
    // Chargement du .env et exposition globale des variables d’environnement
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Configuration TypeORM vers PostgreSQL
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres' as const,
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 5432),
        username: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,

        // IMPORTANT: ajouter CasperSubmissionEntity ici
        entities: [SessionEntity, LogEntity, AgeProofEntity, CasperSubmissionEntity],

        synchronize: false, // on NE laisse PAS TypeORM modifier le schéma
        migrationsRun: false,
      }),
    }),

    // Repositories injectables
    // IMPORTANT: ajouter CasperSubmissionEntity ici aussi
    TypeOrmModule.forFeature([SessionEntity, LogEntity, AgeProofEntity, CasperSubmissionEntity]),

    AuthModule,
  ],
  controllers: [
  AppController,
  OnboardingController,
  ProofController,
  ApiVerifyController,
  CasperController,
  AdminController,
  AdminEnvController,
],

  providers: [AppService, DbService, OnboardingService, AgeProofService],
})
export class AppModule {}
