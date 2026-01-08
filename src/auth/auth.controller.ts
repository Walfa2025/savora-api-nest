import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @UseGuards(JwtAuthGuard)
  @Get("/auth/me")
  me(@Req() req: any) {
    return { user: req.user };
  }

  @Post("/auth/request-otp")
  requestOtp(@Body() body: { phoneE164: string }) {
    return this.auth.requestOtp(body.phoneE164);
  }

  @Post("/auth/verify-otp")
  verifyOtp(@Body() body: { requestId: string; otp: string }) {
    return this.auth.verifyOtp(body.requestId, body.otp);
  }
}
