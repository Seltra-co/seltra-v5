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

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [StoreController, ProductsController, CloudinaryController, StoreImageController],
  providers: [StoreService, BuildEventsService, TenantEventsService, StoreImageService],
  exports: [StoreService, StoreImageService],
})
export class StoreModule {}