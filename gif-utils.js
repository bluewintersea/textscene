// Shared palette, dithering and lossless delta frames for both export paths.
globalThis.textsceneGif = {
  encoder(width, height, config, smooth = true) {
    const encoder = gifenc.GIFEncoder(), utilities = this;
    let previous = null;
    return {
      writeFrame(pixels, delay) {
        if (pixels.length !== width * height * 4) throw new Error('Invalid GIF frame dimensions');
        const indexed = utilities.frame(pixels, config, width, smooth);
        let left = 0, top = 0, frameWidth = width, frameHeight = height, frame = indexed;
        // Transparent source frames require disposal-to-background; keep those full size.
        // Opaque exports retain the previous frame and repaint every changed index.
        if (previous && !config.transparent) {
          let right = -1, bottom = -1;
          left = width; top = height;
          for (let y = 0; y < height; y++) {
            const row = y * width;
            for (let x = 0; x < width; x++) {
              if (indexed[row + x] === previous[row + x]) continue;
              if (x < left) left = x;
              if (x > right) right = x;
              if (y < top) top = y;
              bottom = y;
            }
          }
          // Preserve an unchanged frame's duration with a harmless one-pixel repaint.
          if (right < 0) { left = top = right = bottom = 0; }
          frameWidth = right - left + 1; frameHeight = bottom - top + 1;
          if (frameWidth !== width || frameHeight !== height) {
            frame = new Uint8Array(frameWidth * frameHeight);
            for (let y = 0; y < frameHeight; y++) {
              const start = (top + y) * width + left;
              frame.set(indexed.subarray(start, start + frameWidth), y * frameWidth);
            }
          }
        }
        encoder.writeFrame(frame, frameWidth, frameHeight, {
          ...utilities.options(config, delay),
          palette: previous ? null : config.colors,
          left, top
        });
        previous = indexed;
      },
      finish() { encoder.finish(); },
      bytes() { return encoder.bytes(); }
    };
  },
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
    // Preserve crisp black outlines and white UI while quantizing other colors.
    const opaque = [...gifenc.quantize(source, transparent ? 253 : 254), [0, 0, 0], [255, 255, 255]];
    return { opaque, colors: transparent ? [...opaque, [0, 0, 0]] : opaque, transparent, transparentIndex: transparent ? opaque.length : 0 };
  },
  frame(pixels, config, width, smooth = true) {
    if (smooth && width > 0) return this.dither(pixels, config, width);
    const indexed = gifenc.applyPalette(pixels, config.opaque);
    if (config.transparent) {
      for (let i = 0; i < indexed.length; i++) {
        if (pixels[i * 4 + 3] < 128) indexed[i] = config.transparentIndex;
      }
    }
    return indexed;
  },
  dither(pixels, config, width) {
    const height = pixels.length / 4 / width;
    if (!Number.isInteger(height)) throw new Error('Invalid GIF frame dimensions');
    const palette = config.opaque, indexed = new Uint8Array(width * height);
    // Keep each source pixel's chroma. Diffusing independent RGB errors can
    // accumulate a false green tint and eventually select the Messages icon green.
    config.tones ||= palette.map(([r,g,b]) => [.2126*r+.7152*g+.0722*b, r-g, b-g]);
    config.candidates ||= new Uint8Array(65536 * 4);
    config.cached ||= new Uint8Array(65536);
    const tones = config.tones, candidates = config.candidates, cached = config.cached;
    let current = new Float32Array(width + 2), next = new Float32Array(width + 2);
    for (let y = 0; y < height; y++) {
      const direction = y % 2 ? -1 : 1;
      for (let x = direction === 1 ? 0 : width - 1; x >= 0 && x < width; x += direction) {
        const pixel = y * width + x, source = pixel * 4, error = x + 1;
        if (config.transparent && pixels[source + 3] < 128) { indexed[pixel] = config.transparentIndex; continue; }
        const r = pixels[source], g = pixels[source+1], b = pixels[source+2];
        const luminance = .2126*r+.7152*g+.0722*b, rg = r-g, bg = b-g;
        const target = Math.max(0, Math.min(255, luminance + Math.max(-48, Math.min(48, current[error]))));
        // Candidates depend on the original color, never on accumulated error.
        const key = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3), base = key * 4;
        if (!cached[key]) {
          const cr = ((key >> 11) & 31) * 8 + 3.5, cg = ((key >> 5) & 63) * 4 + 1.5, cb = (key & 31) * 8 + 3.5;
          const cy = .2126*cr+.7152*cg+.0722*cb, crg = cr-cg, cbg = cb-cg;
          const distances = [Infinity, Infinity, Infinity, Infinity];
          for (let j = 0; j < tones.length; j++) {
            const tone = tones[j], distance = (cy-tone[0])**2 + 2*((crg-tone[1])**2 + (cbg-tone[2])**2);
            for (let n = 0; n < 4; n++) if (distance < distances[n]) {
              for (let k = 3; k > n; k--) { distances[k] = distances[k-1]; candidates[base+k] = candidates[base+k-1]; }
              distances[n] = distance; candidates[base+n] = j; break;
            }
          }
          cached[key] = 1;
        }
        let chosen = candidates[base], minimum = Infinity;
        for (let j = 0; j < 4; j++) {
          const index = candidates[base+j], tone = tones[index];
          const distance = (target-tone[0])**2 + 2*((rg-tone[1])**2 + (bg-tone[2])**2);
          if (distance < minimum) { minimum = distance; chosen = index; }
        }
        indexed[pixel] = chosen;
        // Diffuse brightness only, with bounded error so isolated colors cannot spread.
        const delta = Math.max(-48, Math.min(48, target - tones[chosen][0]));
        current[error + direction] += delta * 7/16;
        next[error - direction] += delta * 3/16;
        next[error] += delta * 5/16;
        next[error + direction] += delta / 16;
      }
      [current, next] = [next, current]; next.fill(0);
    }
    return indexed;
  },
  options(config, delay) {
    return { palette: config.colors, delay, repeat: 0, transparent: config.transparent, transparentIndex: config.transparentIndex, dispose: config.transparent ? 2 : 1 };
  }
};
