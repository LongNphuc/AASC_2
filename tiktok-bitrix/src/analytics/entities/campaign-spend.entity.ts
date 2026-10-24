import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../../database/numeric.transformer';

/** Bảng campaign_spend: tiền công ty trả TikTok cho một campaign trong một ngày (readme_design.md mục 9.4). */
@Entity({ name: 'campaign_spend' })
export class CampaignSpend {
  @PrimaryGeneratedColumn('uuid')
  uuid: string;

  @Column({ name: 'campaign_id', type: 'varchar', length: 255 })
  campaignId: string;

  @Column({ name: 'campaign_name', type: 'varchar', nullable: true })
  campaignName: string | null;

  /** YYYY-MM-DD. */
  @Column({ name: 'spend_date', type: 'date' })
  spendDate: string;

  @Column({
    type: 'numeric',
    precision: 15,
    scale: 2,
    transformer: numericTransformer,
  })
  spend: number;

  @Column({ type: 'varchar', length: 3, default: 'VND' })
  currency: string;

  @Column({ type: 'integer', nullable: true })
  impressions: number | null;

  @Column({ type: 'integer', nullable: true })
  clicks: number | null;
}
