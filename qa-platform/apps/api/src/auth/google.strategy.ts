import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type Profile, type VerifyCallback } from 'passport-google-oauth20';
import { prisma } from '@qa/db';

/**
 * Google SSO restricted to the company domain (ALLOWED_EMAIL_DOMAIN).
 * On first sign-in the user row is created with role "tester".
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor() {
    super({
      // Placeholder when Google isn't configured so the provider can construct
      // (dev sign-in is used instead). Real Google works once creds are set.
      clientID: process.env.GOOGLE_CLIENT_ID || 'unconfigured-client-id',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'unconfigured-client-secret',
      callbackURL: process.env.GOOGLE_CALLBACK_URL ?? 'http://localhost:4000/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    const email = profile.emails?.[0]?.value?.toLowerCase();
    const domain = process.env.ALLOWED_EMAIL_DOMAIN ?? 'breadfast.com';
    if (!email || !email.endsWith(`@${domain}`)) {
      return done(new UnauthorizedException(`Only @${domain} accounts may sign in`), undefined);
    }

    const user = await prisma.user.upsert({
      where: { googleSub: profile.id },
      update: { email, name: profile.displayName ?? email },
      create: { googleSub: profile.id, email, name: profile.displayName ?? email },
    });

    done(null, { id: user.id, email: user.email, name: user.name, role: user.role });
  }
}
