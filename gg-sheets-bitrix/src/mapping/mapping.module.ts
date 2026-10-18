import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BitrixModule } from '../bitrix/bitrix.module';
import { GoogleModule } from '../google/google.module';
import { MappingController } from './controllers/mapping.controller';
import { Mapping } from './entities/mapping.entity';
import { MappingRepository } from './repositories/mapping.repository';
import { MappingValidatorService } from './services/mapping-validator.service';
import { MappingService } from './services/mapping.service';

/** Mapping cột Sheet ↔ trường Bitrix24: lưu theo phiên bản, kiểm tra, đổi giá trị. */
@Module({
  imports: [TypeOrmModule.forFeature([Mapping]), GoogleModule, BitrixModule],
  controllers: [MappingController],
  providers: [MappingRepository, MappingValidatorService, MappingService],
  exports: [MappingService, MappingValidatorService],
})
export class MappingModule {}
