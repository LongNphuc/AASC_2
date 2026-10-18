import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { API_DOC, ERROR } from '../../common/constants/messages.constant';
import { ErrorKbn, errorKbnOf } from '../../common/kbn/error.kbn';
import { SaveMappingDto } from '../dto/save-mapping.dto';
import { listRules } from '../rules/row-rules';
import { MappingService } from '../services/mapping.service';

@ApiTags(API_DOC.MAPPING.TAG)
@ApiSecurity('api-key')
@Controller('mapping')
export class MappingController {
  constructor(private readonly mappings: MappingService) {}

  @Get()
  @ApiOperation({ summary: API_DOC.MAPPING.CURRENT })
  async current() {
    const latest = await this.mappings.latest();
    if (!latest) {
      return {
        version: null,
        mappingJson: null,
        createdAt: null,
        valid: false,
        errors: [
          {
            path: '',
            errorKbn: ErrorKbn.MAPPING_INVALID,
            message: ERROR.SYNC.NO_MAPPING,
          },
        ],
      };
    }
    const base = {
      version: latest.version,
      mappingJson: latest.mappingJson,
      createdAt: latest.createdAt,
    };
    try {
      const { issues } = await this.mappings.check(latest.mappingJson);
      return { ...base, valid: issues.length === 0, errors: issues };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...base,
        valid: false,
        errors: [{ path: '', errorKbn: errorKbnOf(error), message }],
      };
    }
  }

  @Put()
  @ApiOperation({ summary: API_DOC.MAPPING.SAVE })
  async save(@Body() body: SaveMappingDto) {
    const saved = await this.mappings.save(body.baseVersion, body.mappingJson);
    return { version: saved.version, createdAt: saved.createdAt };
  }

  @Get('versions')
  @ApiOperation({ summary: API_DOC.MAPPING.VERSIONS })
  versions() {
    return this.mappings.listVersions();
  }

  @Get('versions/:version')
  @ApiOperation({ summary: API_DOC.MAPPING.VERSION })
  async version(@Param('version', ParseIntPipe) version: number) {
    const mapping = await this.mappings.findVersion(version);
    return {
      version: mapping.version,
      mappingJson: mapping.mappingJson,
      createdAt: mapping.createdAt,
    };
  }

  @Get('rules')
  @ApiOperation({ summary: API_DOC.MAPPING.RULES })
  rules() {
    return listRules();
  }
}
