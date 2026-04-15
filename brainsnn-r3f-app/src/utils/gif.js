import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpegInstance = null;

export async function getFFmpeg(onProgress, onStatus) {
  if (ffmpegInstance) return ffmpegInstance;

  onStatus?.('Loading FFmpeg core...');
  const ffmpeg = new FFmpeg();

  ffmpeg.on('progress', ({ progress }) => {
    onProgress?.(Math.round(progress * 100));
  });

  const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
  });

  ffmpegInstance = ffmpeg;
  return ffmpegInstance;
}

export async function convertWebMBlobToGif(blob, options = {}, onProgress, onStatus) {
  const ffmpeg = await getFFmpeg(onProgress, onStatus);
  const { trimStart = 0, trimDuration = 2.5, fps = 12, width = 720 } = options;

  onStatus?.('Preparing conversion...');
  await ffmpeg.writeFile('input.webm', await fetchFile(blob));

  onStatus?.('Converting WebM to GIF...');
  await ffmpeg.exec([
    '-ss', String(trimStart),
    '-t', String(trimDuration),
    '-i', 'input.webm',
    '-vf',
    `fps=${fps},scale=${width}:-1:flags=lanczos:force_original_aspect_ratio=decrease,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse`,
    '-loop', '0',
    'output.gif'
  ]);

  const data = await ffmpeg.readFile('output.gif');
  const gifBlob = new Blob([data.buffer], { type: 'image/gif' });
  const url = URL.createObjectURL(gifBlob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'brainsnn-recording.gif';
  a.click();

  URL.revokeObjectURL(url);
  onStatus?.('GIF ready');
  onProgress?.(100);

  return gifBlob;
}
