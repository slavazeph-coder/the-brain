export async function fontsReady() {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // ignore font loading errors
    }
  }
}

export async function copyText(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(String(text || ''));
      return true;
    }
  } catch {
    // ignore clipboard errors
  }
  return false;
}

export async function renderScoreCard({ toyTitle = 'BrainSNN', hook = '', url = '' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#06060a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#00f5ff';
    ctx.font = 'bold 48px sans-serif';
    ctx.fillText(String(toyTitle), 64, 140);
    ctx.fillStyle = '#f1f5f9';
    ctx.font = '32px sans-serif';
    ctx.fillText(String(hook), 64, 210);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '24px monospace';
    ctx.fillText(String(url), 64, 550);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode score card PNG'));
    }, 'image/png');
  });
}

export async function shareOrDownload({ blob, filename = 'score.png', title = 'BrainSNN', caption = '' } = {}) {
  await copyText(caption);
  if (blob && typeof URL !== 'undefined') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return 'downloaded';
  }
  void title;
  return 'cancelled';
}
