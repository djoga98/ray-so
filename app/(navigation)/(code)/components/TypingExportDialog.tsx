"use client";

import { Button } from "@/components/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/dialog";
import { Input } from "@/components/input";
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger, SelectValue } from "@/components/select";
import { Switch } from "@/components/switch";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toBlob } from "../lib/image";
import { fileNameAtom } from "../store";
import {
  isTypingVideoFps,
  TYPING_VIDEO_FPS_OPTIONS,
  typingCursorAtom,
  typingDurationAtom,
  typingPlaybackProgressAtom,
  typingVideoFpsAtom,
} from "../store/animation";
import { codeAtom } from "../store/code";
import { derivedFlashMessageAtom } from "../store/flash";
import { EXPORT_SIZE_OPTIONS, exportSizeAtom, isExportSize, SIZE_LABELS } from "../store/image";
import { FrameContext } from "../store/FrameContextStore";
import download from "../util/download";
import {
  createRenderableCanvas,
  createRenderableImage,
  getSupportedVideoFormat,
  recordVideo,
  waitForNextPaint,
} from "../util/exportVideo";
import type { RenderableFrame } from "../util/exportVideo";
import { getTypingRenderStateKey } from "../util/typingAnimation";

import KeyboardIcon from "../assets/icons/keyboard-16.svg";

type TypingExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const FINAL_HOLD_DURATION_SECONDS = 0.75;

async function waitForCodeLayerRenderState(codeLayerNode: HTMLElement, renderStateKey: string, timeoutMs = 5000) {
  if (codeLayerNode.dataset.exportRenderState === renderStateKey) {
    return;
  }

  const startedAt = performance.now();

  await new Promise<void>((resolve, reject) => {
    const check = () => {
      if (codeLayerNode.dataset.exportRenderState === renderStateKey) {
        resolve();
        return;
      }

      if (performance.now() - startedAt >= timeoutMs) {
        reject(new Error("Timed out while waiting for the highlighted code layer to render"));
        return;
      }

      requestAnimationFrame(check);
    };

    requestAnimationFrame(check);
  });
}

export function TypingExportDialog({ open, onOpenChange }: TypingExportDialogProps) {
  const frameContext = useContext(FrameContext);
  const [typingDuration, setTypingDuration] = useAtom(typingDurationAtom);
  const [typingCursor, setTypingCursor] = useAtom(typingCursorAtom);
  const [typingVideoFps, setTypingVideoFps] = useAtom(typingVideoFpsAtom);
  const [exportSize, setExportSize] = useAtom(exportSizeAtom);
  const [, setTypingPlaybackProgress] = useAtom(typingPlaybackProgressAtom);
  const [, setFlashMessage] = useAtom(derivedFlashMessageAtom);
  const code = useAtomValue(codeAtom);
  const customFileName = useAtomValue(fileNameAtom);
  const supportedFormat = useMemo(() => getSupportedVideoFormat(), []);
  const fileName = customFileName.replaceAll(" ", "-") || "ray-so-export";
  const [isExporting, setIsExporting] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const previewFrameRef = useRef<number | null>(null);
  const previewTimeoutRef = useRef<number | null>(null);
  const characterCount = useMemo(() => Array.from(code).length, [code]);
  const estimatedFrameCount = Math.max(1, Math.ceil(typingDuration * typingVideoFps));
  const estimatedVideoDuration =
    (estimatedFrameCount + Math.round(typingVideoFps * FINAL_HOLD_DURATION_SECONDS)) / typingVideoFps;

  const stopPreview = useCallback(() => {
    if (previewFrameRef.current !== null) {
      cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }

    if (previewTimeoutRef.current !== null) {
      window.clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = null;
    }

    setTypingPlaybackProgress(null);
    setIsPreviewing(false);
  }, [setTypingPlaybackProgress]);

  const playPreview = useCallback(() => {
    stopPreview();
    setErrorMessage(null);
    setIsPreviewing(true);

    const durationMs = Math.max(250, typingDuration * 1000);
    const startedAt = performance.now();

    const tick = (timestamp: number) => {
      const progress = Math.min((timestamp - startedAt) / durationMs, 1);
      setTypingPlaybackProgress(progress);

      if (progress < 1) {
        previewFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      previewTimeoutRef.current = window.setTimeout(() => {
        stopPreview();
      }, 450);
    };

    setTypingPlaybackProgress(0);
    previewFrameRef.current = requestAnimationFrame(tick);
  }, [setTypingPlaybackProgress, stopPreview, typingDuration]);

  const handlePreviewClick = useCallback(() => {
    if (isPreviewing) {
      stopPreview();
      return;
    }

    onOpenChange(false);
    playPreview();
  }, [isPreviewing, onOpenChange, playPreview, stopPreview]);

  const exportVideo = useCallback(async () => {
    if (!supportedFormat) {
      setErrorMessage("This browser cannot record the frame as a video. Try a recent Chromium-based browser.");
      return;
    }

    if (!frameContext?.current) {
      setErrorMessage("Could not find the code frame to export.");
      return;
    }

    stopPreview();
    setErrorMessage(null);
    setIsExporting(true);
    setFlashMessage({ icon: <KeyboardIcon />, message: "Exporting typing video" });

    const frameNode = frameContext.current;
    const codeLayerNode = frameNode.querySelector<HTMLElement>("[data-export-layer='code']");

    if (!codeLayerNode) {
      setIsExporting(false);
      setTypingPlaybackProgress(null);
      setErrorMessage("Could not find the highlighted code layer to export.");
      return;
    }

    const frameRect = frameNode.getBoundingClientRect();
    const codeLayerRect = codeLayerNode.getBoundingClientRect();
    const width = Math.round(frameRect.width * exportSize);
    const height = Math.round(frameRect.height * exportSize);
    const codeLayerX = Math.round((codeLayerRect.left - frameRect.left) * exportSize);
    const codeLayerY = Math.round((codeLayerRect.top - frameRect.top) * exportSize);
    const codeLayerWidth = Math.round(codeLayerRect.width * exportSize);
    const codeLayerHeight = Math.round(codeLayerRect.height * exportSize);
    const frameCount = Math.max(1, Math.ceil(typingDuration * typingVideoFps));
    const finalHoldFrameCount = Math.max(1, Math.round(typingVideoFps * FINAL_HOLD_DURATION_SECONDS));

    try {
      const previousIgnoreValue = codeLayerNode.dataset.ignoreInExport;
      let baseFrameBlob: Blob | null = null;

      codeLayerNode.dataset.ignoreInExport = "true";

      try {
        baseFrameBlob = await toBlob(frameNode, {
          pixelRatio: exportSize,
        });
      } finally {
        if (previousIgnoreValue === undefined) {
          delete codeLayerNode.dataset.ignoreInExport;
        } else {
          codeLayerNode.dataset.ignoreInExport = previousIgnoreValue;
        }
      }

      if (!baseFrameBlob) {
        throw new Error("Could not render the static frame for the typing animation export");
      }

      const baseFrameImage = await createRenderableImage(baseFrameBlob);
      const compositeCanvas = createRenderableCanvas(width, height);

      const compositeContext = compositeCanvas.getContext("2d");

      if (!compositeContext) {
        throw new Error("Could not create a canvas context for the typing animation export");
      }

      let lastRenderStateKey = "";

      const videoBlob = await (async () => {
        try {
          return await recordVideo({
            fps: typingVideoFps,
            frameCount,
            width,
            height,
            mimeType: supportedFormat.mimeType,
            finalHoldFrameCount,
            renderFrame: async (frameIndex): Promise<RenderableFrame> => {
              const progress = frameCount === 1 ? 1 : frameIndex / (frameCount - 1);
              const renderStateKey = getTypingRenderStateKey(characterCount, progress, typingCursor);

              if (renderStateKey === lastRenderStateKey) {
                return compositeCanvas;
              }

              setTypingPlaybackProgress(progress);
              await waitForNextPaint();
              await waitForCodeLayerRenderState(codeLayerNode, renderStateKey);

              const frameBlob = await toBlob(codeLayerNode, {
                pixelRatio: exportSize,
              });

              if (!frameBlob) {
                throw new Error("Could not render the code layer for the typing animation export");
              }

              const codeLayerImage = await createRenderableImage(frameBlob);

              compositeContext.clearRect(0, 0, width, height);
              compositeContext.drawImage(baseFrameImage, 0, 0, width, height);
              compositeContext.drawImage(codeLayerImage, codeLayerX, codeLayerY, codeLayerWidth, codeLayerHeight);

              if ("close" in codeLayerImage && typeof codeLayerImage.close === "function") {
                codeLayerImage.close();
              }

              lastRenderStateKey = renderStateKey;

              return compositeCanvas;
            },
          });
        } finally {
          if ("close" in baseFrameImage && typeof baseFrameImage.close === "function") {
            baseFrameImage.close();
          }
        }
      })();

      const objectUrl = URL.createObjectURL(videoBlob);
      download(objectUrl, `${fileName}.${supportedFormat.extension}`);

      window.setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 30_000);

      setFlashMessage({
        icon: <KeyboardIcon />,
        message: `${supportedFormat.extension.toUpperCase()} exported!`,
        timeout: 2000,
      });
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Typing video export failed";
      setErrorMessage(message);
      setFlashMessage({
        icon: <KeyboardIcon />,
        message: "Typing video export failed",
        timeout: 2500,
      });
    } finally {
      setTypingPlaybackProgress(null);
      setIsPreviewing(false);
      setIsExporting(false);
    }
  }, [
    characterCount,
    exportSize,
    fileName,
    frameContext,
    onOpenChange,
    setFlashMessage,
    setTypingPlaybackProgress,
    stopPreview,
    supportedFormat,
    typingCursor,
    typingDuration,
    typingVideoFps,
  ]);

  useEffect(() => {
    if (!open) {
      setErrorMessage(null);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      stopPreview();
    };
  }, [stopPreview]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="medium">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <DialogTitle>Typing Animation</DialogTitle>
            <DialogDescription>
              Export the current snippet as a typing animation video. Higher frame rates and larger export sizes take
              longer to render.
            </DialogDescription>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm text-gray-11">
              <span className="font-medium text-gray-12">Duration</span>
              <Input
                type="number"
                min={1}
                max={15}
                step={0.5}
                value={typingDuration}
                onChange={(event) => {
                  const nextDuration = event.currentTarget.valueAsNumber;

                  if (Number.isFinite(nextDuration)) {
                    setTypingDuration(Math.min(Math.max(nextDuration, 1), 15));
                  }
                }}
              />
            </label>

            <label className="flex flex-col gap-2 text-sm text-gray-11">
              <span className="font-medium text-gray-12">Frame rate</span>
              <Select
                value={typingVideoFps.toString()}
                onValueChange={(value) => {
                  const nextFps = Number(value);

                  if (isTypingVideoFps(nextFps)) {
                    setTypingVideoFps(nextFps);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select frame rate" />
                </SelectTrigger>
                <SelectContent>
                  {TYPING_VIDEO_FPS_OPTIONS.map((fps) => (
                    <SelectItem key={fps} value={fps.toString()}>
                      <SelectItemText>{fps} fps</SelectItemText>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="flex flex-col gap-2 text-sm text-gray-11">
              <span className="font-medium text-gray-12">Export size</span>
              <Select
                value={exportSize.toString()}
                onValueChange={(value) => {
                  const nextSize = Number(value);

                  if (isExportSize(nextSize)) {
                    setExportSize(nextSize);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select size" />
                </SelectTrigger>
                <SelectContent>
                  {EXPORT_SIZE_OPTIONS.map((size) => (
                    <SelectItem key={size} value={size.toString()}>
                      <SelectItemText>{SIZE_LABELS[size]}</SelectItemText>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <div className="flex flex-col gap-2 text-sm text-gray-11">
              <span className="font-medium text-gray-12">Cursor</span>
              <div className="flex h-[30px] items-center justify-between rounded-md border border-gray-a4 bg-gray-2 px-3">
                <span className="text-gray-11">Show typing cursor</span>
                <Switch checked={typingCursor} onCheckedChange={setTypingCursor} />
              </div>
            </div>
          </div>

          <div className="rounded-md border border-gray-a4 bg-gray-a2 p-3 text-sm text-gray-11">
            <p className="font-medium text-gray-12">Export summary</p>
            <p className="mt-1">
              {characterCount} characters, {estimatedFrameCount} frames, about {estimatedVideoDuration.toFixed(1)}s of
              video in {supportedFormat?.extension.toUpperCase() ?? "video"} format.
            </p>
          </div>

          {errorMessage ? (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {errorMessage}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={handlePreviewClick} disabled={isExporting}>
              {isPreviewing ? "Stop preview" : "Play preview"}
            </Button>
            <Button variant="primary" onClick={exportVideo} disabled={isExporting || isPreviewing || !supportedFormat}>
              {isExporting ? "Exporting…" : `Export ${supportedFormat?.extension.toUpperCase() ?? "Video"}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
