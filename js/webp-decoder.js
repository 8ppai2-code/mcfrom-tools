
// Animated WebP frame extraction via the WebCodecs ImageDecoder API, which
// is built into modern Chrome/Edge and handles WebP's VP8/VP8L frame data
// (lossy + lossless + alpha) without needing a hand-written decoder.
// Falls back with a clear error if the browser doesn't support it.
async function parseAnimatedWebP(arrayBuffer) {
  if (typeof ImageDecoder === 'undefined') {
    throw new Error('هذا المتصفح لا يدعم فك ترميز WebP المتحرك (ImageDecoder API). جرّب Chrome أو Edge حديث، أو استخدم GIF بدلاً منه.');
  }

  const blob = new Blob([arrayBuffer], { type: 'image/webp' });
  const decoder = new ImageDecoder({ data: blob.stream(), type: 'image/webp' });
  await decoder.tracks.ready;
  const track = decoder.tracks.selectedTrack;
  const frameCount = track ? track.frameCount : 1;

  if (!frameCount || frameCount < 1) {
    throw new Error('لم يتم العثور على أي فريمات في ملف WebP هذا');
  }

  const canvases = [];
  for (let i = 0; i < frameCount; i++) {
    const { image } = await decoder.decode({ frameIndex: i });
    const canvas = document.createElement('canvas');
    canvas.width = image.displayWidth;
    canvas.height = image.displayHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    image.close();
    canvases.push(canvas);
  }

  decoder.close();
  return canvases;
}
