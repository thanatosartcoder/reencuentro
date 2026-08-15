import { Module } from '@nestjs/common';
import { BackupModule } from 'src/modules/backup/backup.module';
import { MonitorController } from './monitor.controller';

@Module({
  imports: [BackupModule],
  controllers: [MonitorController],
})
export class MonitorModule {}
