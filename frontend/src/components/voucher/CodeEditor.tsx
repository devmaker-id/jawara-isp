import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { Compartment, EditorSelection, EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { html } from '@codemirror/lang-html';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * Editor kode template voucher (CodeMirror 6).
 *
 * - Tinggi diatur wadah (bukan isi): scroll vertikal & horizontal ada DI DALAM
 *   editor, jadi 1.000 baris tidak memanjangkan halaman.
 * - Warna memakai CSS variable (index.css) sehingga tema siang/malam berganti
 *   otomatis tanpa membuat ulang editor.
 * - Variabel {{...}} ditandai; yang tidak dikenal diberi garis merah.
 *
 * ponytail: tanpa lint/autocomplete berat — yang dibutuhkan hanya menyunting
 * teks panjang dengan nyaman. Tambahkan lint bila validasi inline diperlukan.
 */

const KNOWN_VARS = [
  'brand',
  'tagline',
  'profile',
  'profile_type',
  'user_type',
  'username',
  'password',
  'price',
  'owner',
  'created_by',
  'customer',
  'status',
  'expires',
  'created_at',
  'printed_at',
];

const theme = EditorView.theme({
  '&': {
    height: '100%',
    width: '100%',
    fontSize: '12.5px',
    color: 'var(--code-text)',
    backgroundColor: 'var(--code-bg)',
  },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    lineHeight: '1.55',
    overflow: 'auto',
  },
  '.cm-content': { caretColor: 'var(--code-cursor)', padding: '8px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--code-cursor)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--code-selection)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--code-gutter-bg)',
    color: 'var(--code-muted)',
    border: 'none',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--code-text)' },
  '.cm-activeLine': { backgroundColor: 'var(--code-active-line)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--code-selection)' },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: 'var(--code-selection)',
    outline: '1px solid var(--border)',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--code-gutter-bg)',
    border: '1px solid var(--border)',
    color: 'var(--code-muted)',
  },
  '.cm-panels': { backgroundColor: 'var(--card)', color: 'var(--code-text)' },
  '.cm-searchMatch': { backgroundColor: 'rgba(251, 191, 36, 0.25)', outline: '1px solid #fbbf24' },
  '.cm-tooltip': {
    backgroundColor: 'var(--card)',
    color: 'var(--code-text)',
    border: '1px solid var(--border)',
  },
});

const highlight = HighlightStyle.define([
  { tag: [tags.tagName, tags.angleBracket], color: 'var(--syn-tag)' },
  { tag: [tags.attributeName, tags.propertyName], color: 'var(--syn-attr)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--syn-string)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'var(--syn-keyword)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--syn-number)' },
  { tag: [tags.variableName, tags.definition(tags.variableName)], color: 'var(--code-text)' },
  { tag: tags.invalid, color: 'var(--danger)', textDecoration: 'underline wavy' },
]);

const variableMatcher = /\{\{\s*([a-z_]+)\s*\}\}/gi;

/** Tandai {{variabel}}: dikenal = aksen, tidak dikenal = garis merah. */
const variableDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view);
    }

    build(view: EditorView): DecorationSet {
      const marks: Range<Decoration>[] = [];
      for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        variableMatcher.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = variableMatcher.exec(text)) !== null) {
          const name = match[1].toLowerCase();
          const className = KNOWN_VARS.includes(name) ? 'cm-voucher-var' : 'cm-voucher-var-bad';
          marks.push(
            Decoration.mark({ class: className }).range(from + match.index, from + match.index + match[0].length),
          );
        }
      }
      return Decoration.set(marks, true);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// Tanpa lineWrapping: baris panjang digeser horizontal, bukan dilipat, supaya
// struktur HTML panjang tetap terbaca.
const baseExtensions: Extension[] = [
  basicSetup,
  html({ autoCloseTags: true, matchClosingTags: true }),
  syntaxHighlighting(highlight),
  theme,
  variableDecorations,
];

export interface CodeEditorHandle {
  /** Sisipkan teks di posisi kursor (menggantikan seleksi bila ada). */
  insert: (text: string) => void;
  focus: () => void;
  /** Posisi kursor saat ini (offset karakter). */
  cursor: () => number;
}

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Tinggi wadah (CSS). Scroll terjadi di dalam editor. */
  height?: string;
  readOnly?: boolean;
  ariaLabel?: string;
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { value, onChange, height = '460px', readOnly, ariaLabel },
  ref,
) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const readOnlyCompartment = useRef(new Compartment());
  const applyingExternal = useRef(false);

  onChangeRef.current = onChange;

  useImperativeHandle(
    ref,
    () => ({
      insert: (text: string) => {
        const instance = view.current;
        if (!instance) return;
        const range = instance.state.selection.main;
        instance.dispatch({
          changes: { from: range.from, to: range.to, insert: text },
          selection: { anchor: range.from + text.length },
          scrollIntoView: true,
        });
        instance.focus();
      },
      focus: () => view.current?.focus(),
      cursor: () => view.current?.state.selection.main.head ?? 0,
    }),
    [],
  );

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        ...baseExtensions,
        readOnlyCompartment.current.of(EditorState.readOnly.of(Boolean(readOnly))),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingExternal.current) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        // Tab menyisipkan 2 spasi; Shift+Tab mengurangi indentasi baris terpilih.
        EditorView.domEventHandlers({
          keydown: (event, viewInstance) => {
            if (event.key !== 'Tab') return false;
            event.preventDefault();
            const changes = viewInstance.state.changeByRange((range) => ({
              changes: { from: range.from, to: range.to, insert: '  ' },
              range: EditorSelection.cursor(range.from + 2),
            }));
            viewInstance.dispatch(changes);
            return true;
          },
        }),
      ],
    });
    view.current = new EditorView({ state, parent: host.current });
    return () => {
      view.current?.destroy();
      view.current = null;
    };
    // Editor dibuat sekali; nilai diperbarui lewat efek di bawah.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sinkronkan nilai dari luar (mis. buka template lain / reset) tanpa loop.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const current = instance.state.doc.toString();
    if (current === value) return;
    applyingExternal.current = true;
    instance.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    applyingExternal.current = false;
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({
      effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(Boolean(readOnly))),
    });
  }, [readOnly]);

  return (
    <div className="voucher-editor-shell rounded-lg border border-slate-700 bg-slate-900" style={{ height }}>
      <div ref={host} className="h-full w-full overflow-hidden" aria-label={ariaLabel ?? 'Editor kode template'} />
    </div>
  );
});

export default CodeEditor;