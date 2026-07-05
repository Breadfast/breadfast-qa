import { Injectable } from '@nestjs/common';
import { Subject, type Observable, filter } from 'rxjs';
import type { RunEvent } from '@qa/shared';

/**
 * In-process pub/sub for run events. The local worker POSTs events to
 * /runs/:id/events (ingest); the SSE endpoint subscribes per-run. Single-node
 * by design (each tester runs their own worker + api locally).
 */
@Injectable()
export class EventsBus {
  private readonly stream = new Subject<RunEvent>();

  publish(event: RunEvent): void {
    this.stream.next(event);
  }

  forRun(runId: string): Observable<RunEvent> {
    return this.stream.asObservable().pipe(filter((e) => e.runId === runId));
  }
}
