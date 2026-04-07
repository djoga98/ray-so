import { BufferTarget, CanvasSource, getFirstEncodableVideoCodec, Output, WebMOutputFormat } from "mediabunny";

type SupportedVideoFormat = {
  extension: "webm";
  mimeType: "video/webm";
};

export type RenderableFrame = HTMLCanvasElement | HTMLImageElement | ImageBitmap;

type RecordVideoOptions = {
  fps: number;
  frameCount: number;
  width: number;
  height: number;
  mimeType: string;
  finalHoldFrameCount?: number;
  renderFrame: (frameIndex: number) => Promise<RenderableFrame>;
};

const VIDEO_FORMAT: SupportedVideoFormat = {
  extension: "webm",
  mimeType: "video/webm",
};

const WEBM_ENCODER_CODECS = ["vp9", "vp8"] as const;
const TARGET_VIDEO_BITRATE = 12_000_000;

export function getSupportedVideoFormat() {
  if (typeof window === "undefined" || typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
    return null;
  }

  return VIDEO_FORMAT;
}

export async function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

export async function createRenderableImage(blob: Blob) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(blob);
  }

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not decode the generated animation frame"));
    };
    image.src = objectUrl;
  });
}

export function createRenderableCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  return canvas;
}

function closeRenderableFrame(frame: RenderableFrame) {
  if ("close" in frame && typeof frame.close === "function") {
    frame.close();
  }
}

async function getSupportedEncoderCodec(width: number, height: number) {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
    throw new Error("WebCodecs video export is not supported in this browser");
  }

  const codec = await getFirstEncodableVideoCodec([...WEBM_ENCODER_CODECS], {
    width,
    height,
    bitrate: TARGET_VIDEO_BITRATE,
  });

  if (!codec) {
    throw new Error("This browser does not support VP8 or VP9 encoding for WebM export");
  }

  return codec;
}

export async function recordVideo({
  fps,
  frameCount,
  width,
  height,
  mimeType,
  finalHoldFrameCount = 0,
  renderFrame,
}: RecordVideoOptions) {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
    throw new Error("WebCodecs video export is not supported in this browser");
  }

  const encoderCodec = await getSupportedEncoderCodec(width, height);
  const target = new BufferTarget();
  const output = new Output({
    format: new WebMOutputFormat(),
    target,
  });
  const encoderCanvas = createRenderableCanvas(width, height);
  const encoderContext = encoderCanvas.getContext("2d");

  if (!encoderContext) {
    throw new Error("Could not create a canvas context for video export");
  }

  const totalFrames = Math.max(1, frameCount) + Math.max(0, finalHoldFrameCount);
  const frameDuration = 1 / fps;
  const videoSource = new CanvasSource(encoderCanvas, {
    codec: encoderCodec,
    bitrate: TARGET_VIDEO_BITRATE,
    bitrateMode: "variable",
    keyFrameInterval: 1,
    latencyMode: "quality",
  });

  output.addVideoTrack(videoSource, {
    frameRate: fps,
    maximumPacketCount: totalFrames,
  });

  let finalized = false;

  try {
    await output.start();

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      const sourceFrame = await renderFrame(Math.min(frameIndex, Math.max(0, frameCount - 1)));

      try {
        encoderContext.clearRect(0, 0, width, height);
        encoderContext.drawImage(sourceFrame, 0, 0, width, height);
        await videoSource.add(frameIndex * frameDuration, frameDuration);
      } finally {
        closeRenderableFrame(sourceFrame);
      }
    }

    videoSource.close();
    await output.finalize();
    finalized = true;

    if (!target.buffer) {
      throw new Error("Video export did not produce any output data");
    }

    return new Blob([target.buffer], { type: mimeType });
  } catch (error) {
    if (!finalized && output.state !== "canceled" && output.state !== "finalized") {
      await output.cancel().catch(() => {});
    }

    throw error;
  }
}
