export async function renderSupplierLinkQr(url: string) {
  const QRCode = (await import('qrcode')).default;
  return new Uint8Array(await QRCode.toBuffer(url, {
    type: 'png',
    errorCorrectionLevel: 'M',
    width: 512,
    margin: 2,
    color: { dark: '#101817', light: '#FFFFFF' },
  }));
}
