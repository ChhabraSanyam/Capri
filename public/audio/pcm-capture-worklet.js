/**
 * AudioWorklet that copies microphone audio into fixed-size blocks and posts them to the page.
 * Used by spike item (d). It runs on the audio thread, so a slow frame on the page thread delays
 * delivery of a block but never loses audio (a ScriptProcessorNode on the page thread does).
 *
 * Message to the page: { samples: Float32Array (transferred), endFrame: number }.
 * `endFrame` is the audio-clock frame at which the block ended, so the page can measure how late a
 * block arrives by comparing it with `audioContext.currentTime * sampleRate`.
 *
 * Served from `public/` as a plain file so it is same-origin and needs no `blob:` script policy.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const requested = options && options.processorOptions && options.processorOptions.blockSize;
    this.size = Number.isInteger(requested) && requested > 0 ? requested : 4096;
    this.block = new Float32Array(this.size);
    this.fill = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input !== undefined && input.length > 0 ? input[0] : undefined;
    if (channel === undefined) return true;

    let offset = 0;
    while (offset < channel.length) {
      const count = Math.min(channel.length - offset, this.size - this.fill);
      this.block.set(channel.subarray(offset, offset + count), this.fill);
      this.fill += count;
      offset += count;
      if (this.fill === this.size) {
        const samples = this.block;
        this.port.postMessage({ samples, endFrame: currentFrame + offset }, [samples.buffer]);
        this.block = new Float32Array(this.size);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor('capri-pcm-capture', PcmCaptureProcessor);
