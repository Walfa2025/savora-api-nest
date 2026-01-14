import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AppController } from './app.controller';
import { HealthController } from './health.controller';
import { OffersController } from './offers.controller';
import { OrdersController } from './orders.controller';
import { PaymentsController } from './payments.controller';
import { OrdersExpirer } from './orders.expirer';
import { AppService } from './app.service';
import { SelfUnblockController } from './self_unblock.controller';
import { SelfUnblockService } from './self_unblock.service';
import { AuthModule } from './auth/auth.module';
import { ExpirerAdminController } from './expirer_admin.controller';
import { AdminUsersController } from './admin_users.controller';
import { VendorsController } from './vendors.controller';
import { AdminOpsController } from './admin_ops.controller';
import { OtpAdminController } from './otp_admin.controller';
import { OtpCleanupService } from './otp_cleanup.service';
import { AdminAuditService } from './admin_audit.service';
import { AdminAuditController } from './admin_audit.controller';
import { DevAuthController } from './dev_auth.controller';
import { PublicFormsController } from './public_forms.controller';
import { PublicFormsService } from './public_forms.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule],
  controllers: [
    AppController,
    HealthController,
    OffersController,
    OrdersController,
    PaymentsController,
    SelfUnblockController,
    ExpirerAdminController,
    AdminUsersController,
    VendorsController,
    AdminOpsController,
    OtpAdminController,
    AdminAuditController,
    DevAuthController,
    PublicFormsController,
  ],
  providers: [
    AppService,
    OrdersExpirer,
    SelfUnblockService,
    OtpCleanupService,
    AdminAuditService,
    PublicFormsService,
  ],
})
export class AppModule {}
