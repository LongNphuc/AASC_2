import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/auth/public.decorator';
import { API_DOC } from '../../common/constants/messages.constant';
import { HealthIndicators } from '../indicators/health.indicators';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly indicators: HealthIndicators,
  ) {}

  /** DB, Redis down thì 503; worker, Bitrix24 down thì "degraded" nhưng vẫn 200. */
  @Get()
  @Public()
  @SkipThrottle()
  @HealthCheck()
  @ApiOperation(API_DOC.HEALTH)
  check() {
    return this.health.check([
      () => this.db.pingCheck('database').withTimeout(3000),
      () => this.indicators.redisPing(),
      () => this.indicators.worker(),
      () => this.indicators.queues(),
      () => this.indicators.bitrix24(),
    ]);
  }
}
