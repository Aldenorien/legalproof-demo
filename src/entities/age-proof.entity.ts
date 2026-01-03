// src/entities/age-proof.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('age_proofs')
export class AgeProofEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', nullable: true })
  session_id: string | null;

  @Column({ type: 'text' })
  wallet_pubkey: string;

  @Column({ type: 'text' })
  user_hash: string;

  @Column({ type: 'text' })
  claim_type: string;

  @Column({ type: 'int' })
  age: number;

  @Column({ type: 'boolean' })
  is_major: boolean;

  @Column({ type: 'timestamptz' })
  valid_from: Date;

  @Column({ type: 'timestamptz' })
  valid_until: Date;

  @Column({ type: 'boolean', default: false })
  revoked: boolean;

  @Column({ type: 'text', nullable: true })
  deploy_hash: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
