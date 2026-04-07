export function getVisibleCharacterCount(characterCount: number, progress: number | null) {
  if (progress === null) {
    return characterCount;
  }

  if (characterCount === 0) {
    return 0;
  }

  return Math.max(0, Math.min(characterCount, Math.floor(progress * characterCount)));
}

export function getVisibleCode(code: string, progress: number | null) {
  if (progress === null) {
    return code;
  }

  const characters = Array.from(code);

  if (characters.length === 0) {
    return "";
  }

  const visibleCharacterCount = getVisibleCharacterCount(characters.length, progress);

  return characters.slice(0, visibleCharacterCount).join("");
}

export function getTypingRenderStateKey(characterCount: number, progress: number | null, showCursor: boolean) {
  const visibleCharacterCount = getVisibleCharacterCount(characterCount, progress);
  const cursorVisible = progress !== null && showCursor && progress < 1;

  return `${visibleCharacterCount}:${cursorVisible ? 1 : 0}`;
}
