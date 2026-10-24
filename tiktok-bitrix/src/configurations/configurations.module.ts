import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BitrixModule } from '../bitrix/bitrix.module';
import { ConfigController } from './controllers/config.controller';
import { Configuration } from './entities/configuration.entity';
import { ConfigurationService } from './services/configuration.service';
import { AlertRulesValidator } from './validators/alert-rules.validator';
import { DealRulesValidator } from './validators/deal-rules.validator';
import { MappingValidator } from './validators/mapping.validator';

@Module({
  imports: [TypeOrmModule.forFeature([Configuration]), BitrixModule],
  controllers: [ConfigController],
  providers: [
    ConfigurationService,
    MappingValidator,
    DealRulesValidator,
    AlertRulesValidator,
  ],
  exports: [ConfigurationService, MappingValidator, DealRulesValidator],
})
export class ConfigurationsModule {}
