import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'sessions' })
export class SessionEntity {
  // BIGSERIAL -> côté TypeORM on le mappe en bigint (string en JS/TS)
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'text' })
  wallet_pubkey: string;

  // URL où renvoyer l’utilisateur après la vérification (optionnel)
  @Column({ type: 'text', nullable: true })
  redirect_url: string | null;

  @Column({ type: 'varchar', length: 32, default: 'pending_mock_fc' })
  status: string;

  @CreateDateColumn({
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at: Date;

  @UpdateDateColumn({
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;
}
