import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../../common/auth/public.decorator';
import { API_DOC } from '../../common/constants/messages.constant';

@ApiTags('Health')
@Public()
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  @ApiOperation({ summary: API_DOC.HEALTH.CHECK })
  async check() {
    const db = await this.dataSource
      .query('SELECT 1')
      .then(() => 'ok')
      .catch(() => 'down');
    return {
      status: db === 'ok' ? 'ok' : 'degraded',
      db,
      time: new Date().toISOString(),
    };
  }
}
