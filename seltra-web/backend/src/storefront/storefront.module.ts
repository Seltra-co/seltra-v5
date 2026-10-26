import { Module } from '@nestjs/common'
import { OrdersModule } from '../orders/orders.module'
import { StorefrontController } from './storefront.controller'
import { StorefrontService } from './storefront.service'

@Module({ imports: [OrdersModule], controllers: [StorefrontController], providers: [StorefrontService] })
export class StorefrontModule {}
