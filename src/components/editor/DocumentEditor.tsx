'use client';

import type { JSONContent } from '@tiptap/core';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';

import './editor.css';

const AUTOSAVE_DELAY_MS = 750;
const MAX_TITLE_LENGTH = 200;

const EMPTY_DOCUMENT: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';

type DraftSnapshot = {
  title: string;
  content: JSONContent;
  contentKey: string;
};

export type DocumentEditorProps = {
  docId: string;
  initialTitle: string;
  initialContent: unknown;
  editable: boolean;
  canRename: boolean;
  onSave: (patch: { title?: string; content?: unknown }) => Promise<void>;
};

type ToolbarButtonProps = {
  label: string;
  disabled: boolean;
  onPress: () => void;
  children: ReactNode;
  active?: boolean;
};

const EMPTY_TOOLBAR_STATE = {
  bold: false,
  italic: false,
  underline: false,
  heading1: false,
  heading2: false,
  heading3: false,
  bulletList: false,
  orderedList: false,
  canBold: false,
  canItalic: false,
  canUnderline: false,
  canHeading1: false,
  canHeading2: false,
  canHeading3: false,
  canBulletList: false,
  canOrderedList: false,
  canUndo: false,
  canRedo: false,
};

function normalizeInitialContent(value: unknown): JSONContent {
  if (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'doc' &&
    'content' in value &&
    Array.isArray(value.content)
  ) {
    return value as JSONContent;
  }

  return EMPTY_DOCUMENT;
}

function canonicalTitle(value: string): string {
  const normalized = value.trim().slice(0, MAX_TITLE_LENGTH);
  return normalized || 'Untitled document';
}

function isDirty(
  draft: DraftSnapshot,
  saved: DraftSnapshot,
  editable: boolean,
  canRename: boolean,
): boolean {
  return (
    (editable && draft.contentKey !== saved.contentKey) ||
    (canRename && canonicalTitle(draft.title) !== canonicalTitle(saved.title))
  );
}

function ToolbarButton({ label, disabled, onPress, children, active }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className="document-editor__tool"
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      title={label}
      disabled={disabled}
      onClick={onPress}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

export default function DocumentEditor({
  docId,
  initialTitle,
  initialContent,
  editable,
  canRename,
  onSave,
}: DocumentEditorProps) {
  const [startingContent] = useState<JSONContent>(() =>
    normalizeInitialContent(initialContent),
  );
  const [title, setTitle] = useState(initialTitle);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  // Mirror of saveState for listeners that must read it without re-subscribing
  // (beforeunload). Reading the state variable there would capture whatever it
  // was when the listener was attached.
  const saveStateRef = useRef<SaveState>('saved');

  const initialSnapshot: DraftSnapshot = {
    title: initialTitle,
    content: startingContent,
    contentKey: JSON.stringify(startingContent),
  };

  const draftRef = useRef<DraftSnapshot>(initialSnapshot);
  const savedRef = useRef<DraftSnapshot>(initialSnapshot);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(false);
  const runSaveRef = useRef<() => void>(() => undefined);

  const clearSaveTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleSave = useCallback(() => {
    clearSaveTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      runSaveRef.current();
    }, AUTOSAVE_DELAY_MS);
  }, [clearSaveTimer]);

  const markDirty = useCallback(
    (nextDraft: DraftSnapshot) => {
      draftRef.current = nextDraft;
      setSaveState('unsaved');
      scheduleSave();
    },
    [scheduleSave],
  );

  const runSave = useCallback(async () => {
    if (inFlightRef.current) return;

    clearSaveTimer();

    const draftAtStart = draftRef.current;
    const savedAtStart = savedRef.current;
    const patch: { title?: string; content?: unknown } = {};

    if (
      canRename &&
      canonicalTitle(draftAtStart.title) !== canonicalTitle(savedAtStart.title)
    ) {
      patch.title = canonicalTitle(draftAtStart.title);
    }

    if (editable && draftAtStart.contentKey !== savedAtStart.contentKey) {
      patch.content = draftAtStart.content;
    }

    if (Object.keys(patch).length === 0) {
      if (mountedRef.current) setSaveState('saved');
      return;
    }

    inFlightRef.current = true;
    if (mountedRef.current) setSaveState('saving');

    try {
      await onSave(patch);

      savedRef.current = {
        title:
          patch.title === undefined ? savedAtStart.title : canonicalTitle(draftAtStart.title),
        content: patch.content === undefined ? savedAtStart.content : draftAtStart.content,
        contentKey:
          patch.content === undefined ? savedAtStart.contentKey : draftAtStart.contentKey,
      };

      if (!mountedRef.current) return;

      if (isDirty(draftRef.current, savedRef.current, editable, canRename)) {
        setSaveState('unsaved');
        scheduleSave();
      } else {
        setSaveState('saved');
      }
    } catch {
      // Keep draftRef untouched: Retry must send the exact latest local draft.
      clearSaveTimer();
      if (mountedRef.current) setSaveState('error');
    } finally {
      inFlightRef.current = false;
    }
  }, [canRename, clearSaveTimer, editable, onSave, scheduleSave]);

  useEffect(() => {
    runSaveRef.current = () => {
      void runSave();
    };
  }, [runSave]);

  useEffect(() => {
    saveStateRef.current = saveState;
  }, [saveState]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      // Flush rather than cancel. Navigating away inside the debounce window
      // used to drop the last edit silently: the timer was cleared and no
      // PATCH was ever sent, so the user watched "Saving…" disappear and
      // assumed it landed. The request outlives the component on purpose.
      if (isDirty(draftRef.current, savedRef.current, editable, canRename)) {
        runSaveRef.current();
      }
      clearSaveTimer();
    };
  }, [canRename, clearSaveTimer, editable]);

  /**
   * Last line of defence for a closing tab. A debounced save cannot complete
   * once the page is gone, so the browser's own "changes you made may not be
   * saved" prompt is the only honest thing left — and it only appears if
   * something registers this listener.
   */
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      const dirty =
        isDirty(draftRef.current, savedRef.current, editable, canRename) ||
        saveStateRef.current === 'error';
      if (!dirty) return;

      // Fire the pending save anyway: on a reload (as opposed to a close) it
      // often completes, and it costs nothing if it does not.
      runSaveRef.current();
      event.preventDefault();
    }

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [canRename, editable]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        link: false,
        strike: false,
      }),
    ],
    content: startingContent,
    editable,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': 'Document content',
        'aria-multiline': 'true',
        'aria-readonly': String(!editable),
        'aria-describedby': `save-status-${docId}`,
        spellcheck: 'true',
        autocapitalize: 'sentences',
      },
    },
    onUpdate: ({ editor: updatedEditor }) => {
      if (!editable) return;

      const content = updatedEditor.getJSON();
      markDirty({
        ...draftRef.current,
        content,
        contentKey: JSON.stringify(content),
      });
    },
  });

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable);
  }, [editable, editor]);

  const selectedState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      if (!currentEditor) return EMPTY_TOOLBAR_STATE;

      // `isEditable` is false until TipTap's view mounts. Capturing it in this
      // initial selector snapshot leaves the toolbar permanently disabled
      // because mounting the view is not itself an editor transaction.
      const commandsEnabled = editable;

      return {
        bold: currentEditor.isActive('bold'),
        italic: currentEditor.isActive('italic'),
        underline: currentEditor.isActive('underline'),
        heading1: currentEditor.isActive('heading', { level: 1 }),
        heading2: currentEditor.isActive('heading', { level: 2 }),
        heading3: currentEditor.isActive('heading', { level: 3 }),
        bulletList: currentEditor.isActive('bulletList'),
        orderedList: currentEditor.isActive('orderedList'),
        // The restricted schema makes each formatting command valid anywhere
        // text can be entered. Using `editor.can()` here froze every button in
        // its pre-mount false state on the first render in production; the
        // selector had no transaction to wake it up until after a command had
        // already been run. Mount + editability are the honest gate.
        canBold: commandsEnabled,
        canItalic: commandsEnabled,
        canUnderline: commandsEnabled,
        canHeading1: commandsEnabled,
        canHeading2: commandsEnabled,
        canHeading3: commandsEnabled,
        canBulletList: commandsEnabled,
        canOrderedList: commandsEnabled,
        canUndo: commandsEnabled && currentEditor.can().chain().focus().undo().run(),
        canRedo: commandsEnabled && currentEditor.can().chain().focus().redo().run(),
      };
    },
  });

  const toolbarState = selectedState ?? EMPTY_TOOLBAR_STATE;

  function handleTitleChange(event: ChangeEvent<HTMLInputElement>) {
    if (!canRename) return;

    const nextTitle = event.target.value;
    setTitle(nextTitle);
    markDirty({ ...draftRef.current, title: nextTitle });
  }

  function handleTitleBlur() {
    if (!canRename) return;

    const normalizedTitle = canonicalTitle(title);
    if (normalizedTitle !== title) {
      setTitle(normalizedTitle);
      markDirty({ ...draftRef.current, title: normalizedTitle });
    }
  }

  return (
    <main id="main-content" tabIndex={-1} className="document-editor" data-document-id={docId}>
      <div className="document-editor__chrome">
        <div className="document-editor__title-row">
          <label className="document-editor__sr-only" htmlFor={`document-title-${docId}`}>
            Document title
          </label>
          <input
            id={`document-title-${docId}`}
            className="document-editor__title"
            value={title}
            onChange={handleTitleChange}
            onBlur={handleTitleBlur}
            readOnly={!canRename}
            aria-readonly={!canRename}
            maxLength={MAX_TITLE_LENGTH}
          />

          <div className={`document-editor__save-state is-${saveState}`}>
            <span
              id={`save-status-${docId}`}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <span className="document-editor__status-dot" aria-hidden="true" />
              {saveState === 'saved' && 'Saved'}
              {saveState === 'unsaved' && 'Unsaved'}
              {saveState === 'saving' && 'Saving…'}
              {saveState === 'error' && 'Error'}
            </span>
            {saveState === 'error' && (
              <button
                type="button"
                className="document-editor__retry"
                onClick={() => void runSave()}
              >
                Retry
              </button>
            )}
          </div>
        </div>

        {editable ? (
          <div className="document-editor__toolbar" role="toolbar" aria-label="Text formatting">
            <div className="document-editor__tool-group" role="group" aria-label="Text style">
              <ToolbarButton
                label="Bold"
                active={toolbarState.bold}
                disabled={!toolbarState.canBold}
                onPress={() => {
                  editor?.chain().focus().toggleBold().run();
                }}
              >
                <strong>B</strong>
              </ToolbarButton>
              <ToolbarButton
                label="Italic"
                active={toolbarState.italic}
                disabled={!toolbarState.canItalic}
                onPress={() => {
                  editor?.chain().focus().toggleItalic().run();
                }}
              >
                <em>I</em>
              </ToolbarButton>
              <ToolbarButton
                label="Underline"
                active={toolbarState.underline}
                disabled={!toolbarState.canUnderline}
                onPress={() => {
                  editor?.chain().focus().toggleUnderline().run();
                }}
              >
                <u>U</u>
              </ToolbarButton>
            </div>

            <span className="document-editor__separator" aria-hidden="true" />

            <div className="document-editor__tool-group" role="group" aria-label="Headings">
              <ToolbarButton
                label="Heading 1"
                active={toolbarState.heading1}
                disabled={!toolbarState.canHeading1}
                onPress={() => {
                  editor?.chain().focus().toggleHeading({ level: 1 }).run();
                }}
              >
                H1
              </ToolbarButton>
              <ToolbarButton
                label="Heading 2"
                active={toolbarState.heading2}
                disabled={!toolbarState.canHeading2}
                onPress={() => {
                  editor?.chain().focus().toggleHeading({ level: 2 }).run();
                }}
              >
                H2
              </ToolbarButton>
              <ToolbarButton
                label="Heading 3"
                active={toolbarState.heading3}
                disabled={!toolbarState.canHeading3}
                onPress={() => {
                  editor?.chain().focus().toggleHeading({ level: 3 }).run();
                }}
              >
                H3
              </ToolbarButton>
            </div>

            <span className="document-editor__separator" aria-hidden="true" />

            <div className="document-editor__tool-group" role="group" aria-label="Lists">
              <ToolbarButton
                label="Bulleted list"
                active={toolbarState.bulletList}
                disabled={!toolbarState.canBulletList}
                onPress={() => {
                  editor?.chain().focus().toggleBulletList().run();
                }}
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 6h11M9 12h11M9 18h11" />
                  <circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
                </svg>
              </ToolbarButton>
              <ToolbarButton
                label="Numbered list"
                active={toolbarState.orderedList}
                disabled={!toolbarState.canOrderedList}
                onPress={() => {
                  editor?.chain().focus().toggleOrderedList().run();
                }}
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10 6h10M10 12h10M10 18h10" />
                  <path d="M3.4 4.8l1.3-.6V8M3.2 12.1c0-.6.5-1 1.1-1 .6 0 1.1.4 1.1 1 0 .9-2.2 1.4-2.2 2.9h2.4M3.3 16.4c.2-.4.6-.6 1.1-.6.6 0 1.1.3 1.1.9s-.5.9-1 .9c.6 0 1.1.3 1.1.9s-.5 1-1.2 1c-.5 0-.9-.2-1.1-.6" />
                </svg>
              </ToolbarButton>
            </div>

            <span className="document-editor__separator" aria-hidden="true" />

            <div className="document-editor__tool-group" role="group" aria-label="History">
              <ToolbarButton
                label="Undo"
                disabled={!toolbarState.canUndo}
                onPress={() => {
                  editor?.chain().focus().undo().run();
                }}
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 8h11a5.5 5.5 0 0 1 0 11H8" />
                  <path d="M7 4L3 8l4 4" />
                </svg>
              </ToolbarButton>
              <ToolbarButton
                label="Redo"
                disabled={!toolbarState.canRedo}
                onPress={() => {
                  editor?.chain().focus().redo().run();
                }}
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 8H10a5.5 5.5 0 0 0 0 11h6" />
                  <path d="M17 4l4 4-4 4" />
                </svg>
              </ToolbarButton>
            </div>
          </div>
        ) : (
          <div className="document-editor__readonly-note" role="note">
            Read-only
          </div>
        )}
      </div>

      <div className="document-editor__canvas">
        <div className="document-editor__sheet">
          {editor ? (
            <EditorContent editor={editor} />
          ) : (
            <div className="document-editor__loading" role="status">
              Loading editor…
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
