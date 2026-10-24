import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { API_DOC, ERROR } from '../../common/constants/messages.constant';
import { KbnHttpException } from '../../common/errors/kbn-http.exception';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import { ListDealsQuery } from '../dto/list-deals.query';
import { DealQueryRepository } from '../repositories/deal-query.repository';

@ApiTags('Deal')
@Controller('api/v1/deals')
export class DealsController {
  constructor(private readonly deals: DealQueryRepository) {}

  @Get()
  @ApiOperation(API_DOC.DEALS.LIST)
  list(@Query() query: ListDealsQuery) {
    return this.deals.list(query);
  }

  @Get(':uuid')
  @ApiOperation(API_DOC.DEALS.DETAIL)
  async detail(@Param('uuid', ParseUUIDPipe) uuid: string) {
    const deal = await this.deals.detail(uuid);
    if (!deal) {
      throw new KbnHttpException(
        404,
        ErrorKbn.NOT_FOUND,
        ERROR.LABEL.NOT_FOUND,
        ERROR.DEAL.NOT_FOUND(uuid),
      );
    }
    return deal;
  }
}
