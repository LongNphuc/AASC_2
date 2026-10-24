import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiAcceptedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { API_DOC, ERROR } from '../../common/constants/messages.constant';
import { KbnHttpException } from '../../common/errors/kbn-http.exception';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import { ConvertToDealDto } from '../dto/convert-to-deal.dto';
import { ListLeadsQuery } from '../dto/list-leads.query';
import { LeadQueryRepository } from '../repositories/lead-query.repository';
import { LeadConversionService } from '../services/lead-conversion.service';

@ApiTags('Lead')
@Controller('api/v1/leads')
export class LeadsController {
  constructor(
    private readonly leads: LeadQueryRepository,
    private readonly conversion: LeadConversionService,
  ) {}

  @Get()
  @ApiOperation(API_DOC.LEADS.LIST)
  list(@Query() query: ListLeadsQuery) {
    return this.leads.list(query);
  }

  @Get(':uuid')
  @ApiOperation(API_DOC.LEADS.DETAIL)
  async detail(@Param('uuid', ParseUUIDPipe) uuid: string) {
    const lead = await this.leads.detail(uuid);
    if (!lead) {
      throw new KbnHttpException(
        404,
        ErrorKbn.NOT_FOUND,
        ERROR.LABEL.NOT_FOUND,
        ERROR.LEAD.NOT_FOUND(uuid),
      );
    }
    return lead;
  }

  @Post(':uuid/convert-to-deal')
  @HttpCode(202)
  @ApiOperation(API_DOC.LEADS.CONVERT)
  @ApiAcceptedResponse({
    schema: {
      example: {
        dealUuid: 'e8b14f2a-3c6d-4a1e-9f70-5b2d8c4e6a13',
        status: 'queued',
      },
    },
  })
  convert(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() body: ConvertToDealDto,
  ) {
    return this.conversion.request(uuid, body);
  }
}
