import { Module } from '@nestjs/common';
import { TestDataController } from './test-data.controller.js';
import { TestDataService } from './test-data.service.js';

@Module({
  controllers: [TestDataController],
  providers: [TestDataService],
  exports: [TestDataService],
})
export class TestDataModule {}
