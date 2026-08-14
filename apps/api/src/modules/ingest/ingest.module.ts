import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IngestRun } from './entities/ingest-run.entity';
import { IngestService } from './ingest.service';
import { IngestController } from './ingest.controller';

@Module({
  imports: [TypeOrmModule.forFeature([IngestRun])],
  controllers: [IngestController],
  providers: [IngestService],
  exports: [IngestService],
})
export class IngestModule {}
