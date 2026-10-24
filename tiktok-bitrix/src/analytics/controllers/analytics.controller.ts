import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { API_DOC } from '../../common/constants/messages.constant';
import {
  CampaignPerformanceQuery,
  ConversionRatesQuery,
} from '../dto/analytics.query';
import { AnalyticsService } from '../services/analytics.service';

@ApiTags('Thống kê')
@Controller('api/v1/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @ApiOperation(API_DOC.ANALYTICS.OVERVIEW)
  overview() {
    return this.analytics.overview();
  }

  @Get('conversion-rates')
  @ApiOperation(API_DOC.ANALYTICS.CONVERSION_RATES)
  conversionRates(@Query() query: ConversionRatesQuery) {
    return this.analytics.conversionRates(query);
  }

  @Get('campaign-performance')
  @ApiOperation(API_DOC.ANALYTICS.CAMPAIGN_PERFORMANCE)
  campaignPerformance(@Query() query: CampaignPerformanceQuery) {
    return this.analytics.campaignPerformance(query);
  }
}
