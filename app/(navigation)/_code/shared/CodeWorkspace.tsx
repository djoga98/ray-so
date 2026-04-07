"use client";

import { useEffect } from "react";
import { useAtom } from "jotai";
import getWasm from "shiki/wasm";
import { Highlighter, getHighlighterCore } from "shiki";
import { NavigationActions } from "@/components/navigation";
import Frame from "@code/components/Frame";
import NoSSR from "@code/components/NoSSR";
import Controls from "@code/components/Controls";
import styles from "@code/code.module.css";
import FrameContextStore from "@code/store/FrameContextStore";
import { highlighterAtom } from "@code/store";
import { shikiTheme } from "@code/store/themes";
import { LANGUAGES } from "@code/util/languages";
import tailwindLight from "@code/assets/tailwind/light.json";
import tailwindDark from "@code/assets/tailwind/dark.json";

type CodeWorkspaceProps = {
  actions: React.ReactNode;
  controls?: React.ReactNode;
};

export function CodeWorkspace({ actions, controls }: CodeWorkspaceProps) {
  const [highlighter, setHighlighter] = useAtom(highlighterAtom);

  useEffect(() => {
    getHighlighterCore({
      themes: [shikiTheme, tailwindLight, tailwindDark],
      langs: [LANGUAGES.javascript.src(), LANGUAGES.tsx.src(), LANGUAGES.swift.src(), LANGUAGES.python.src()],
      loadWasm: getWasm,
    }).then((loadedHighlighter) => {
      setHighlighter(loadedHighlighter as Highlighter);
    });
  }, [setHighlighter]);

  return (
    <FrameContextStore>
      <NavigationActions>{actions}</NavigationActions>
      <div className={styles.app}>
        <NoSSR>
          {highlighter && <Frame />}
          {controls ?? <Controls />}
        </NoSSR>
      </div>
    </FrameContextStore>
  );
}
