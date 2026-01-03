import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DbService } from './db.service';

import { SessionEntity } from './entities/session.entity';
import { LogEntity } from './entities/log.entity';
import { AgeProofEntity } from './entities/age-proof.entity';

import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

import { AgeProofService } from './age-proof.service';
import { ProofController } from './proof.controller';
import { ApiVerifyController } from './api-verify.controller';

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
        entities: [SessionEntity, LogEntity, AgeProofEntity],
        synchronize: false, // on NE laisse PAS TypeORM modifier le schéma
        migrationsRun: false,
      }),
    }),

    // Repositories injectables
    TypeOrmModule.forFeature([SessionEntity, LogEntity, AgeProofEntity]),
  ],
  controllers: [
    AppController,
    OnboardingController,
    ProofController,
    ApiVerifyController, // <-- ajout ici
  ],
  providers: [AppService, DbService, OnboardingService, AgeProofService],
})
export class AppModule {}
