// Reserve one palette entry for the transparent area outside the phone.
globalThis.textsceneGif = {
  palette(pixels, transparent = false) {
    let source = pixels;
    if (transparent) {
      source = new Uint8Array(pixels.length);
      let length = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < 128) continue;
        source.set(pixels.subarray(i, i + 4), length);
        length += 4;
      }
      source = source.subarray(0, length);
    }
    const opaque = gifenc.quantize(source, transparent ? 255 : 256);
    return { opaque, colors: transparent ? [...opaque, [0, 0, 0]] : opaque, transparent, transparentIndex: transparent ? opaque.length : 0 };
  },
  frame(pixels, config) {
    const indexed = gifenc.applyPalette(pixels, config.opaque);
    if (config.transparent) {
      for (let i = 0; i < indexed.length; i++) {
        if (pixels[i * 4 + 3] < 128) indexed[i] = config.transparentIndex;
      }
    }
    return indexed;
  },
  options(config, delay) {
    return { palette: config.colors, delay, repeat: 0, transparent: config.transparent, transparentIndex: config.transparentIndex, dispose: config.transparent ? 2 : 1 };
  }
};
