import { Injectable } from '@nestjs/common';
import { DealStatusKbn, JobStepKbn } from '../../common/kbn/status.kbn';
import { ConversionKbn } from '../../common/kbn/type.kbn';
import { ConversionService } from '../../conversions/services/conversion.service';
import { DealEventsService } from '../../deals/services/deal-events.service';
import type { JobContext } from './job-context';
import type { PipelineStep, StepOutcome } from './step.types';

/**
 * Job bitrix-deal-event (readme_design.md mục 7): BX_DEAL_SYNC → BX_PROBABILITY
 * → CONVERSION. Điều kiện báo DEAL_WON là "deal đang WON mà chưa báo thành
 * công", nên job lỗi sau khi đã ghi WON thì lần chạy lại vẫn báo.
 */
@Injectable()
export class BitrixDealEventJob {
  constructor(
    private readonly dealEvents: DealEventsService,
    private readonly conversions: ConversionService,
  ) {}

  steps(): PipelineStep[] {
    return [
      {
        kbn: JobStepKbn.BX_DEAL_SYNC,
        run: (ctx) => this.dealEvents.syncDeal(ctx),
      },
      {
        kbn: JobStepKbn.BX_PROBABILITY,
        run: (ctx) => this.dealEvents.syncProbability(ctx),
      },
      { kbn: JobStepKbn.CONVERSION, run: (ctx) => this.dealWon(ctx) },
    ];
  }

  private async dealWon(ctx: JobContext): Promise<StepOutcome> {
    const deal = await this.dealEvents.dealOfEvent(ctx);
    if (deal?.statusKbn === DealStatusKbn.WON) {
      await this.conversions.ensureSent(deal, ConversionKbn.DEAL_WON);
    }
    return {};
  }
}
