import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'sessions' })
export class SessionEntity {
  // BIGSERIAL -> côté TypeORM on le mappe en bigint
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string; // bigint -> string en JS/TS

  @Column({ type: 'text' })
  wallet_pubkey: string;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
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
