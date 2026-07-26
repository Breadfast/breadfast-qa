/**
 * Structured UI dump contract (BACKLOG-002 VT3, ADR-002 Rev.2 §2).
 *
 * The producer-agnostic format for structured evidence extracted from a live
 * app — DOM/accessibility tree (web), page-source (mobile), or OCR (unstructured
 * surfaces). ANY producer (Selenium CDP, Appium, Playwright, the AI execution
 * agent) may emit this; the platform consumes it in the validation pyramid (VT4).
 *
 * VT3 is "capture only" — this module defines the contract; nothing compares
 * against it yet. Browser-safe (no fs); re-exported through the package index.
 */
import { z } from 'zod';
import { Rect, SCREEN_PLATFORMS } from './screen-registry.js';

/** How the structured evidence was obtained. */
export const STRUCTURED_SOURCES = ['dom', 'a11y', 'page-source', 'ocr', 'figma', 'mixed'] as const;
export type StructuredSource = (typeof STRUCTURED_SOURCES)[number];

/**
 * One extracted UI element. All fields optional — a producer emits whatever it
 * can resolve. `parentId`→`id` links let the component-tree layer (VT4-L2)
 * derive hierarchy without a raw tree. `styles` are raw computed values,
 * normalized at compare time via `normalize.ts`.
 */
export const StructuredElement = z.object({
  id: z.string().optional(),
  parentId: z.string().optional(),
  role: z.string().optional(), // aria/semantic role, e.g. "button", "heading"
  name: z.string().optional(), // accessible name
  text: z.string().optional(), // visible text content
  testId: z.string().optional(), // data-testid / resource-id / accessibility id
  bounds: Rect.optional(),
  styles: z.record(z.string()).optional(), // raw computed styles (color, font-size, …)
});
export type StructuredElement = z.infer<typeof StructuredElement>;

/** A structured dump of one captured screen. */
export const StructuredDump = z.object({
  source: z.enum(STRUCTURED_SOURCES).default('mixed'),
  platform: z.enum(SCREEN_PLATFORMS).optional(),
  screenId: z.string().optional(),
  capturedAt: z.string().optional(), // ISO time
  elements: z.array(StructuredElement).default([]),
});
export type StructuredDump = z.infer<typeof StructuredDump>;
