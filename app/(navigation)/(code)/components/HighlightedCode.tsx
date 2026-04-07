import classNames from "classnames";
import React, { useEffect, useMemo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { highlightedLinesAtom, highlighterAtom, loadingLanguageAtom } from "../store";
import { typingCursorAtom, typingPlaybackProgressAtom } from "../store/animation";
import { themeDarkModeAtom, themeAtom } from "../store/themes";
import { getTypingRenderStateKey, getVisibleCode } from "../util/typingAnimation";
import { Language, LANGUAGES } from "../util/languages";

import styles from "./Editor.module.css";

type PropTypes = {
  selectedLanguage: Language | null;
  code: string;
};

const HighlightedCode: React.FC<PropTypes> = ({ selectedLanguage, code }) => {
  const [highlightedHtml, setHighlightedHtml] = useState("");
  const [renderedStateKey, setRenderedStateKey] = useState("");
  const highlighter = useAtomValue(highlighterAtom);
  const setIsLoadingLanguage = useSetAtom(loadingLanguageAtom);
  const highlightedLines = useAtomValue(highlightedLinesAtom);
  const darkMode = useAtomValue(themeDarkModeAtom);
  const theme = useAtomValue(themeAtom);
  const typingPlaybackProgress = useAtomValue(typingPlaybackProgressAtom);
  const showTypingCursor = useAtomValue(typingCursorAtom);
  const characterCount = useMemo(() => Array.from(code).length, [code]);
  const themeName = theme.id === "tailwind" ? (darkMode ? "tailwind-dark" : "tailwind-light") : "css-variables";
  const targetRenderStateKey = useMemo(
    () => getTypingRenderStateKey(characterCount, typingPlaybackProgress, showTypingCursor),
    [characterCount, showTypingCursor, typingPlaybackProgress],
  );
  const displayCode = useMemo(() => {
    const visibleCode = getVisibleCode(code, typingPlaybackProgress);

    if (typingPlaybackProgress === null || !showTypingCursor || typingPlaybackProgress >= 1) {
      return visibleCode;
    }

    return `${visibleCode}▍`;
  }, [code, typingPlaybackProgress, showTypingCursor]);

  useEffect(() => {
    let cancelled = false;

    const generateHighlightedHtml = async () => {
      if (!highlighter || !selectedLanguage || selectedLanguage === LANGUAGES.plaintext) {
        return displayCode.replace(/[\u00A0-\u9999<>\&]/g, (i) => `&#${i.charCodeAt(0)};`);
      }

      const loadedLanguages = highlighter.getLoadedLanguages() || [];
      const hasLoadedLanguage = loadedLanguages.includes(selectedLanguage.name.toLowerCase());

      if (!hasLoadedLanguage && selectedLanguage.src) {
        setIsLoadingLanguage(true);
        await highlighter.loadLanguage(selectedLanguage.src);
        setIsLoadingLanguage(false);
      }

      let lang = selectedLanguage.name.toLowerCase();
      if (lang === "typescript") {
        lang = "tsx";
      }

      return highlighter.codeToHtml(displayCode, {
        lang: lang,
        theme: themeName,
        transformers: [
          {
            line(node, line) {
              node.properties["data-line"] = line;
              if (highlightedLines.includes(line)) this.addClassToHast(node, "highlighted-line");
            },
          },
        ],
      });
    };

    generateHighlightedHtml().then((newHtml) => {
      if (!cancelled) {
        setHighlightedHtml(newHtml);
        setRenderedStateKey(targetRenderStateKey);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    displayCode,
    highlightedLines,
    highlighter,
    selectedLanguage,
    setIsLoadingLanguage,
    targetRenderStateKey,
    themeName,
  ]);

  return (
    <div
      className={classNames(styles.formatted, selectedLanguage === LANGUAGES.plaintext && styles.plainText)}
      data-export-layer="code"
      data-export-render-state={renderedStateKey}
      dangerouslySetInnerHTML={{
        __html: highlightedHtml,
      }}
    />
  );
};

export default HighlightedCode;
