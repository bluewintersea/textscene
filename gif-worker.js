importScripts('./gifenc.js', './gif-utils.js');
let encoder, palette, width, height;
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') {
      width = data.width; height = data.height;
      palette = textsceneGif.palette(new Uint8Array(data.pixels), data.transparent);
      encoder = gifenc.GIFEncoder();
      self.postMessage({ ready: true });
    } else if (data.type === 'frame') {
      const pixels = new Uint8Array(data.pixels);
      encoder.writeFrame(textsceneGif.frame(pixels, palette), width, height, textsceneGif.options(palette, data.delay));
      self.postMessage({ ready: true });
    } else if (data.type === 'finish') {
      encoder.finish();
      const bytes = encoder.bytes();
      self.postMessage({ bytes }, [bytes.buffer]);
    }
  } catch (error) { self.postMessage({ error: error.message }); }
};
