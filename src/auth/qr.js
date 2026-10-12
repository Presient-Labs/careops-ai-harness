import qrcode from 'qrcode-generator';

// Server-side QR for the otpauth URL, returned as an image data URL (the page's CSP allows data: images, not inline markup).
export function qrDataUrl(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
