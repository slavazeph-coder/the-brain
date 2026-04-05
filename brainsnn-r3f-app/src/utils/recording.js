import { convertWebMBlobToGif } from './gif';

export function startCanvasRecording(canvas, { onStop, onStatus, onProgress } = {}) {
  if (!canvas?.captureStream) throw new Error('Canvas captureStream is not supported in this browser.');

  const stream = canvas.captureStream(24);
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 3_500_000
  });

  const chunks = [];

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'brainsnn-recording.webm';
    a.click();

    URL.revokeObjectURL(url);
    onStop?.(blob);
  };

  recorder.start();
  onStatus?.('Recording WebM...');
  onProgress?.(0);

  return {
    stop: () => recorder.stop(),
    convertToGif: async (gifOptions = {}) => {
      if (recorder.state !== 'inactive') {
        await new Promise((resolve) => {
          recorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            onStop?.(blob);
            resolve(blob);
          };
          recorder.stop();
        });
      }

      const blob = new Blob(chunks, { type: 'video/webm' });
      return convertWebMBlobToGif(blob, gifOptions, onProgress, onStatus);
    }
  };
}
