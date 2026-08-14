import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/** Global: cualquier módulo que reciba archivos necesita el mismo almacenamiento. */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
