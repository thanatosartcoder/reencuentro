import { Module } from '@nestjs/common';
import { StorageModule } from 'src/modules/storage/storage.module';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';

@Module({
  imports: [StorageModule],
  controllers: [BackupController],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
