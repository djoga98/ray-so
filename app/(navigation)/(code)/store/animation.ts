import { atom } from "jotai";
import { atomWithHash } from "jotai-location";
import { atomWithStorage } from "jotai/utils";

export const TYPING_VIDEO_FPS_OPTIONS = [12, 24, 30, 60] as const;

export type TypingVideoFps = (typeof TYPING_VIDEO_FPS_OPTIONS)[number];

export function isTypingVideoFps(value: TypingVideoFps | unknown): value is TypingVideoFps {
  return TYPING_VIDEO_FPS_OPTIONS.indexOf(value as TypingVideoFps) !== -1;
}

function deserializeTypingDuration(value: string) {
  const duration = Number(value);

  if (!Number.isFinite(duration)) {
    return 4;
  }

  return Math.min(Math.max(duration, 1), 15);
}

export const typingDurationAtom = atomWithHash<number>("typingDuration", 4, {
  serialize(value) {
    return value.toString();
  },
  deserialize(value) {
    return deserializeTypingDuration(value);
  },
});

export const typingCursorAtom = atomWithHash<boolean>("typingCursor", true);

export const typingPlaybackProgressAtom = atom<number | null>(null);

export const typingVideoFpsAtom = atomWithStorage<TypingVideoFps>("typingVideoFps", TYPING_VIDEO_FPS_OPTIONS[0]);
