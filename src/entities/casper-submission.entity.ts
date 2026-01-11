import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

/**
 * Journalisation des soumissions vers le node Casper (RPC),
 * utile en prod pour diagnostiquer les payloads envoyés et les réponses.
 */
@Entity({ name: 'casper_submissions' })
export class CasperSubmissionEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', nullable: true })
  wallet_pubkey: string | null;

  @Column({ type: 'text', nullable: true })
  chain_name: string | null;

  @Column({ type: 'text' })
  rpc_method: string;

  @Column({ type: 'text', nullable: true })
  hash: string | null;

  // Données meta/payload/résultats : on utilise jsonb (PostgreSQL)
  @Column({ type: 'jsonb', nullable: true })
  meta: any | null;

  @Column({ type: 'jsonb', nullable: true })
  payload: any | null;

  @Column({ type: 'jsonb', nullable: true })
  node_result: any | null;

  @Column({ type: 'jsonb', nullable: true })
  node_error: any | null;

  @CreateDateColumn({
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at: Date;
}
