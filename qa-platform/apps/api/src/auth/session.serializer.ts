import { Injectable } from '@nestjs/common';
import { PassportSerializer } from '@nestjs/passport';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

@Injectable()
export class SessionSerializer extends PassportSerializer {
  serializeUser(user: SessionUser, done: (err: unknown, user: SessionUser) => void) {
    done(null, user);
  }

  deserializeUser(payload: SessionUser, done: (err: unknown, user: SessionUser) => void) {
    done(null, payload);
  }
}
