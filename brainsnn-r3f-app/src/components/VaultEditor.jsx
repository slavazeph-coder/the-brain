import React, { useEffect, useRef } from 'react';
import { EditorView, keymap, highlightActiveLine, lineNumbers } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
} from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput } from '@codemirror/language';

/**
 * Layer 109 — Vault editor (CodeMirror 6 backend).
 *
 * Drop-in replacement for the textarea in VaultPanel. Adds:
 *   - markdown syntax highlighting
 *   - find / replace (Ctrl-F)
 *   - undo / redo with proper history
 *   - active-line highlight
 *   - bracket auto-close (great for [[ ]] and (\() types)
 *   - wikilink autocomplete via a custom completion source
 *
 * The component is uncontrolled in the React sense — we mount one
 * EditorView per `noteId` and update its contents only when the active
 * note changes. Live edits stream out via the `onChange` callback.
 */

function wikilinkCompletion(getNoteTitles) {
  return (context) => {
    const before = context.state.doc.sliceString(0, context.pos);
    const match = /\[\[([^\][\n]*)$/.exec(before);
    if (!match) return null;
    const term = match[1].toLowerCase();
    const titles = getNoteTitles();
    const options = [];
    for (const title of titles) {
      const t = title.toLowerCase();
      if (!term || t.startsWith(term) || t.includes(term)) {
        options.push({
          label: title,
          type: 'text',
          apply: `${title}]]`,
        });
      }
      if (options.length >= 12) break;
    }
    if (!options.length) return null;
    return {
      from: context.pos - match[1].length,
      options,
      filter: false,
    };
  };
}

const editorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'rgba(255,255,255,0.025)',
      color: '#e2e8f0',
      borderRadius: '4px',
      border: '1px solid rgba(255,255,255,0.08)',
    },
    '.cm-content': {
      fontFamily: 'monospace',
      fontSize: '13px',
      lineHeight: '1.55',
      padding: '8px',
      caretColor: '#5ad4ff',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: '#475569',
      border: 'none',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(90,212,255,0.04)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(90,212,255,0.08)' },
    '.cm-cursor': { borderLeftColor: '#5ad4ff' },
    '.cm-tooltip-autocomplete': {
      backgroundColor: '#1e293b',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '4px',
      fontFamily: 'monospace',
      fontSize: '12px',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'rgba(90,212,255,0.15)',
      color: '#5ad4ff',
    },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(90,212,255,0.15)',
    },
    '.cm-searchMatch': { backgroundColor: 'rgba(253,171,67,0.25)' },
  },
  { dark: true },
);

export default function VaultEditor({ noteId, value, onChange, onBlur, getNoteTitles }) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const titleRef = useRef(getNoteTitles);

  // Keep refs current without rebuilding the editor on every render.
  onChangeRef.current = onChange;
  onBlurRef.current = onBlur;
  titleRef.current = getNoteTitles;

  // (Re)mount the editor whenever the active note changes.
  useEffect(() => {
    if (!hostRef.current) return undefined;

    const updateListener = EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        const next = u.state.doc.toString();
        onChangeRef.current?.(next);
      }
    });
    const blurListener = EditorView.domEventHandlers({
      blur: () => { onBlurRef.current?.(); },
    });

    const state = EditorState.create({
      doc: value || '',
      extensions: [
        lineNumbers(),
        history(),
        indentOnInput(),
        closeBrackets(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        markdown(),
        autocompletion({
          override: [wikilinkCompletion(() => titleRef.current?.() || [])],
          activateOnTyping: true,
          maxRenderedOptions: 12,
        }),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...completionKeymap,
        ]),
        editorTheme,
        EditorView.lineWrapping,
        updateListener,
        blurListener,
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // We intentionally remount on noteId change so each note gets fresh
    // history. Otherwise undo crosses notes which is confusing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  // External `value` changes (e.g., from import or external save) should
  // sync into the doc without resetting cursor for the trivial case.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === (value || '')) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value || '' },
    });
  }, [value]);

  return (
    <div
      ref={hostRef}
      style={{
        minHeight: 300,
        maxHeight: 480,
        overflow: 'auto',
        borderRadius: 4,
      }}
    />
  );
}
