import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Bảng notifications: một thông báo cho một người nhận (readme_design.md mục 6.6). */
@Entity({ name: 'notifications' })
export class Notification {
  /** Cũng là TAG khi gửi im.notify.system.add: gửi lại cùng TAG thì Bitrix24 thay bản cũ. */
  @PrimaryGeneratedColumn('uuid')
  uuid: string;

  @Column({ name: 'type_kbn', type: 'integer' })
  typeKbn: number;

  @Column({ type: 'varchar', length: 20, default: 'bitrix' })
  channel: string;

  @Column({ name: 'recipient_user_id', type: 'integer' })
  recipientUserId: number;

  /** deal, submission, alert, report. */
  @Column({ name: 'ref_type', type: 'varchar', length: 30 })
  refType: string;

  @Column({ name: 'ref_uuid', type: 'uuid' })
  refUuid: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ name: 'status_kbn', type: 'integer' })
  statusKbn: number;

  @Column({ name: 'error_kbn', type: 'integer', nullable: true })
  errorKbn: number | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
