/**
 * OCR fallback adapter (BACKLOG-002 VT3-S3, ADR-002 Rev.2 §2).
 *
 * OCR is the LAST resort — used only for unstructured surfaces (canvas, raster
 * images, native-drawn content with no structured metadata), never where a DOM /
 * accessibility / page-source dump is available. VT3 ships a pluggable interface
 * + a null default (no heavy dependency); a real engine is wired only when the
 * VT4 text layer needs unstructured text. Browser-safe.
 */

export interface OcrResult {
  text: string;
  confidence?: number; // 0..1
}

export interface OcrAdapter {
  /** Recognize text in an image. Implementations may be async (engine/network). */
  recognize(imagePath: string): Promise<OcrResult>;
}

/** No-op adapter: recognizes nothing. The safe default until a real engine is wired. */
export const nullOcrAdapter: OcrAdapter = {
  async recognize(): Promise<OcrResult> {
    return { text: '', confidence: 0 };
  },
};
