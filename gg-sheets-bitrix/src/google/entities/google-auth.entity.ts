import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type GoogleAuthMode = 'service_account' | 'oauth';

/**
 * Bảng google_auth: access token Google, mỗi chế độ xác thực một dòng.
 * Batch "Làm mới token Google" ghi access token; các lệnh gọi Sheets API chỉ đọc.
 */
@Entity({ name: 'google_auth' })
export class GoogleAuth {
  @PrimaryGeneratedColumn('uuid')
  uuid: string;

  @Column({ name: 'auth_mode', type: 'varchar', length: 20, unique: true })
  authMode: GoogleAuthMode;

  /** Email của service account, hoặc của tài khoản đã đăng nhập (OAuth). */
  @Column({
    name: 'account_email',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  accountEmail: string | null;

  /** Chỉ chế độ OAuth: có được sau khi đăng nhập Google. */
  @Column({ name: 'refresh_token', type: 'text', nullable: true })
  refreshToken: string | null;

  @Column({ name: 'access_token', type: 'text', nullable: true })
  accessToken: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'refreshed_at', type: 'timestamptz', nullable: true })
  refreshedAt: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
