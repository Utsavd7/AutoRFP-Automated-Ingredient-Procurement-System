import type { Worker } from 'tesseract.js';

type OcrProgress = {
  image: number;
  total: number;
  progress: number;
  status: string;
};

type RecognizedLine = {
  text: string;
  confidence: number;
};

function abortError() {
  return new DOMException('Photo reading was cancelled.', 'AbortError');
}

function checkedSignal(signal: AbortSignal) {
  if (signal.aborted) throw abortError();
}

function resultLines(result: Tesseract.Page): RecognizedLine[] {
  const lines = result.blocks?.flatMap((block) =>
    block.paragraphs.flatMap((paragraph) => paragraph.lines),
  ) ?? [];
  if (lines.length > 0) {
    return lines
      .map((line) => ({
        text: line.text.trim(),
        confidence: Math.min(1, Math.max(0, line.confidence / 100)),
      }))
      .filter((line) => line.text.length > 0);
  }
  const confidence = Math.min(1, Math.max(0, result.confidence / 100));
  return result.text
    .split(/\r?\n/)
    .map((text) => ({ text: text.trim(), confidence }))
    .filter((line) => line.text.length > 0);
}

export async function recognizeMenuPhotos(
  photos: readonly File[],
  options: {
    signal: AbortSignal;
    onProgress: (progress: OcrProgress) => void;
  },
) {
  checkedSignal(options.signal);
  let worker: Worker | null = null;
  let activeImage = 0;
  let terminated = false;
  const terminate = async () => {
    if (terminated) return;
    terminated = true;
    await worker?.terminate().catch(() => undefined);
  };
  const onAbort = () => { void terminate(); };
  options.signal.addEventListener('abort', onAbort, { once: true });

  try {
    options.onProgress({
      image: 0,
      total: photos.length,
      progress: 0,
      status: 'Preparing the photo reader',
    });
    const { createWorker, OEM } = await import('tesseract.js');
    checkedSignal(options.signal);
    worker = await createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr/core',
      langPath: '/ocr/lang',
      workerBlobURL: false,
      logger(message) {
        options.onProgress({
          image: activeImage,
          total: photos.length,
          progress: message.progress,
          status: activeImage > 0 ? 'Reading menu photo' : 'Preparing the photo reader',
        });
      },
    });
    checkedSignal(options.signal);

    const recognized: RecognizedLine[] = [];
    for (const [index, photo] of photos.entries()) {
      checkedSignal(options.signal);
      activeImage = index + 1;
      options.onProgress({
        image: activeImage,
        total: photos.length,
        progress: 0,
        status: 'Reading menu photo',
      });
      const result = await worker.recognize(
        photo,
        {},
        { text: true, blocks: true },
      );
      checkedSignal(options.signal);
      recognized.push(...resultLines(result.data));
    }

    return {
      text: recognized.map((line) => line.text).join('\n'),
      confidences: recognized.map((line) => line.confidence),
    };
  } catch (error) {
    if (options.signal.aborted) throw abortError();
    throw error;
  } finally {
    options.signal.removeEventListener('abort', onAbort);
    await terminate();
  }
}

