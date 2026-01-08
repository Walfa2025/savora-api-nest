import { Body, Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { SelfUnblockService } from "./self_unblock.service";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { RolesGuard } from "./auth/roles.guard";
import { Roles } from "./auth/roles.decorator";
import { UserRole } from "@prisma/client";

type AuthedReq = Request & { user?: { id: string; role: UserRole } };

@Controller()
export class SelfUnblockController {
  constructor(private readonly svc: SelfUnblockService) {}

  @UseGuards(JwtAuthGuard)
  @Post("/me/self-unblock/bank-transfer/init")
  init(@Req() req: AuthedReq) {
    const userId = req.user?.id;
    return this.svc.initForUser(userId!);
  }

  @UseGuards(JwtAuthGuard)
  @Post("/me/self-unblock/bank-transfer/:paymentId/proof")
  proof(@Req() req: AuthedReq, @Param("paymentId") paymentId: string) {
    return this.svc.markProof(paymentId, req.user!.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post("/admin/self-unblock/:paymentId/confirm")
  confirm(@Param("paymentId") paymentId: string, @Body() body: { bankTxnRef: string }) {
    return this.svc.confirm(paymentId, body.bankTxnRef);
  }
}
