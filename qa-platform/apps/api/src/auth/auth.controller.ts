import { Controller, Get, NotFoundException, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { prisma } from '@qa/db';

@Controller('auth')
export class AuthController {
  @Get('google')
  @UseGuards(AuthGuard('google'))
  login() {
    // Passport redirects to Google.
  }

  /**
   * Dev sign-in — disabled in production. Establishes a session for a local
   * dev user so the platform is usable without a Google OAuth client.
   */
  @Get('dev')
  async devLogin(@Req() req: Request, @Res() res: Response) {
    if (process.env.NODE_ENV === 'production') throw new NotFoundException();
    const email = (process.env.DEV_USER_EMAIL ?? 'dev@breadfast.com').toLowerCase();
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { googleSub: `dev:${email}`, email, name: 'Dev Tester', role: 'admin' },
    });
    const sessionUser = { id: user.id, email: user.email, name: user.name, role: user.role };
    req.login(sessionUser, (err) => {
      const web = `http://localhost:${process.env.WEB_PORT ?? 3000}`;
      if (err) return res.status(500).send(String(err));
      res.redirect(web);
    });
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  callback(@Res() res: Response) {
    const web = `http://localhost:${process.env.WEB_PORT ?? 3000}`;
    res.redirect(web);
  }

  @Get('me')
  me(@Req() req: Request) {
    return req.user ?? null;
  }

  @Get('logout')
  logout(@Req() req: Request, @Res() res: Response) {
    req.logout(() => {
      const web = `http://localhost:${process.env.WEB_PORT ?? 3000}/login`;
      res.redirect(web);
    });
  }
}
