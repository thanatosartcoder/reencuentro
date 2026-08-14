import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MissingPersonReport } from './entities/missing-person-report.entity';
import { SightingReport } from './entities/sighting-report.entity';
import { PersonPhoto } from './entities/person-photo.entity';
import { MatchCandidate } from './entities/match-candidate.entity';
import { PersonsService } from './persons.service';
import { PersonsController } from './persons.controller';
import { MatchingService } from './matching/matching.service';
import { MatchesController } from './matching/matches.controller';
import { PhotosService } from './photos.service';
import { PhotosController } from './photos.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([MissingPersonReport, SightingReport, PersonPhoto, MatchCandidate]),
  ],
  controllers: [PersonsController, MatchesController, PhotosController],
  providers: [PersonsService, MatchingService, PhotosService],
  exports: [PersonsService, MatchingService],
})
export class PersonsModule {}
