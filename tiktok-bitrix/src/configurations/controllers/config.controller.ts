import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BitrixMetadataService } from '../../bitrix/services/bitrix-metadata.service';
import { API_DOC, ERROR } from '../../common/constants/messages.constant';
import { KbnHttpException } from '../../common/errors/kbn-http.exception';
import { ErrorKbn } from '../../common/kbn/error.kbn';
import { LEAD_EVENT_PATHS } from '../../leads/types/lead-event.types';
import {
  SaveAlertsDto,
  SaveMappingDto,
  SaveRulesDto,
} from '../dto/save-config.dto';
import { ConfigurationService } from '../services/configuration.service';
import {
  CONFIG_KEY,
  type AlertRulesConfig,
  type ConfigError,
  type DealRulesConfig,
  type FieldMapping,
  type StoredConfig,
} from '../types/configuration.types';
import { AlertRulesValidator } from '../validators/alert-rules.validator';
import { DealRulesValidator } from '../validators/deal-rules.validator';
import { MappingValidator } from '../validators/mapping.validator';

/**
 * GET/PUT /api/v1/config/mappings, /rules, /alerts (readme_api.md mục 6).
 * PUT kèm version đang sửa: lệch thì 409 (20009). Cấu hình sai bị từ chối,
 * không lưu, kèm lỗi từng chỗ. Lưu xong áp dụng ngay cho job kế tiếp.
 */
@ApiTags('Cấu hình')
@Controller('api/v1/config')
export class ConfigController {
  constructor(
    private readonly configs: ConfigurationService,
    private readonly metadata: BitrixMetadataService,
    private readonly mappingValidator: MappingValidator,
    private readonly rulesValidator: DealRulesValidator,
    private readonly alertsValidator: AlertRulesValidator,
  ) {}

  @Get('mappings')
  @ApiOperation(API_DOC.CONFIG.GET_MAPPINGS)
  async getMappings() {
    return this.mappingBody(
      await this.configs.get<FieldMapping>(CONFIG_KEY.FIELD_MAPPING),
    );
  }

  @Put('mappings')
  @ApiOperation(API_DOC.CONFIG.PUT_MAPPINGS)
  async putMappings(@Body() body: SaveMappingDto) {
    const leadFields = await this.metadata.leadFields();
    reject(
      'Mapping',
      this.mappingValidator.validate(body.field_mapping, leadFields),
    );
    return this.mappingBody(
      await this.configs.save(
        CONFIG_KEY.FIELD_MAPPING,
        body.field_mapping,
        body.version,
      ),
    );
  }

  @Get('rules')
  @ApiOperation(API_DOC.CONFIG.GET_RULES)
  async getRules() {
    return rulesBody(
      await this.configs.get<DealRulesConfig>(CONFIG_KEY.DEAL_RULES),
    );
  }

  @Put('rules')
  @ApiOperation(API_DOC.CONFIG.PUT_RULES)
  async putRules(@Body() body: SaveRulesDto) {
    const value: DealRulesConfig = {
      deal_rules: body.deal_rules,
      stage_probability: body.stage_probability,
      assignment_rules: body.assignment_rules,
    };
    reject('Rule', this.rulesValidator.validate(value));
    return rulesBody(
      await this.configs.save(CONFIG_KEY.DEAL_RULES, value, body.version),
    );
  }

  @Get('alerts')
  @ApiOperation(API_DOC.CONFIG.GET_ALERTS)
  async getAlerts() {
    return alertsBody(
      await this.configs.get<AlertRulesConfig>(CONFIG_KEY.ALERT_RULES),
    );
  }

  @Put('alerts')
  @ApiOperation(API_DOC.CONFIG.PUT_ALERTS)
  async putAlerts(@Body() body: SaveAlertsDto) {
    reject('Ngưỡng cảnh báo', this.alertsValidator.validate(body.alert_rules));
    return alertsBody(
      await this.configs.save(
        CONFIG_KEY.ALERT_RULES,
        body.alert_rules,
        body.version,
      ),
    );
  }

  private mappingBody(stored: StoredConfig<FieldMapping>) {
    return {
      field_mapping: stored.value,
      version: stored.version,
      updated_at: stored.updatedAt,
      supported_paths: [...LEAD_EVENT_PATHS, 'answers.<slug>'],
      reserved_fields: this.mappingValidator.reservedFields,
    };
  }
}

function rulesBody(stored: StoredConfig<DealRulesConfig>) {
  return {
    ...stored.value,
    version: stored.version,
    updated_at: stored.updatedAt,
  };
}

function alertsBody(stored: StoredConfig<AlertRulesConfig>) {
  return {
    alert_rules: stored.value,
    version: stored.version,
    updated_at: stored.updatedAt,
  };
}

/** Có lỗi thì 400: 20006 khi mọi lỗi là field không dùng được, còn lại 20004. */
function reject(what: string, errors: ConfigError[]): void {
  if (errors.length === 0) return;
  const allFieldErrors = errors.every(
    (e) => e.errorKbn === ErrorKbn.FIELD_INVALID,
  );
  throw new KbnHttpException(
    400,
    allFieldErrors ? ErrorKbn.FIELD_INVALID : ErrorKbn.CONFIG_INVALID,
    ERROR.LABEL.CONFIG_INVALID,
    ERROR.CONFIG.INVALID(what, errors.length),
    { errors },
  );
}
