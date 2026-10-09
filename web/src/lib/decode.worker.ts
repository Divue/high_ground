// Decodes PNG data files off the main thread. Depth frames keep only the red channel.
type Req = { id: number; url: string; gray: boolean }

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, url, gray } = e.data
  try {
    const r = await fetch(url)
    // a dev server may answer a missing file with index.html (SPA fallback)
    if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/')) throw new Error(`missing ${url}`)
    const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
    const { width, height } = bmp
    const ctx = new OffscreenCanvas(width, height).getContext('2d', { colorSpace: 'srgb' }) as OffscreenCanvasRenderingContext2D
    ctx.drawImage(bmp, 0, 0)
    bmp.close()
    const rgba = ctx.getImageData(0, 0, width, height).data
    let data: Uint8Array | Uint8ClampedArray = rgba
    if (gray) {
      data = new Uint8Array(width * height)
      for (let i = 0; i < data.length; i++) data[i] = rgba[4 * i]
    }
    ;(self as unknown as Worker).postMessage({ id, data, width, height }, [data.buffer])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: String(err) })
  }
}
