import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { StoreController } from './store.controller'
import { StoreService } from './store.service'
import { ProductsController } from './products.controller'
import { CloudinaryController } from './cloudinary.controller'
import { BuildEventsService } from './build-events.service'
import { TenantEventsService } from '../internal-ops/events/tenant-events.service'
import { StoreImageController } from './store-image.controller'
import { StoreImageService } from './store-image.service'
import { RunService } from '../build/run.service'
import { RunController } from '../build/run.controller'
import { ProjectController } from '../build/project.controller'
import { CreditsService } from '../credits/credits.service'

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [StoreController, ProductsController, CloudinaryController, StoreImageController, RunController, ProjectController],
  providers: [StoreService, BuildEventsService, TenantEventsService, StoreImageService, RunService, CreditsService],
  exports: [StoreService, StoreImageService, CreditsService],
})
export class StoreModule {}