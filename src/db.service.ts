// src/db.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Client } from 'pg';

@Injectable()
export class DbService implements OnModuleInit {
  private client: Client;

  constructor() {
    this.client = new Client({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });
  }

  async onModuleInit() {
    await this.client.connect();
    // Simple ping pour vérifier que la connexion marche
    const res = await this.client.query('SELECT 1 as ok');
    console.log('PostgreSQL connection OK, test result:', res.rows[0]);
  }

  // On garde une méthode simple pour réutiliser plus tard si besoin
  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const res = await this.client.query(sql, params);
    return res.rows;
  }
}
