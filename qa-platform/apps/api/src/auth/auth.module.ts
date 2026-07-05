import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { GoogleStrategy } from './google.strategy.js';
import { SessionSerializer } from './session.serializer.js';
import { AuthController } from './auth.controller.js';

@Module({
  imports: [PassportModule.register({ session: true, defaultStrategy: 'google' })],
  controllers: [AuthController],
  providers: [GoogleStrategy, SessionSerializer],
})
export class AuthModule {}
