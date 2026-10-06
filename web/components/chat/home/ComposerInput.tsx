"use client";

import {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import ChatSpaceMenu, {
  type ChatSpaceSelectionCounts,
  type SelectableSpaceKey,
} from "@/components/chat/space/ChatSpaceMenu";
import { shouldSubmitOnEnter } from "@/lib/composer-keyboard";

interface ComposerInputProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  activeCapabilityKey: string;
  isMathAnimatorMode: boolean;
  isVisualizeMode: boolean;
  // When true, parent has attachments/references queued and will accept a
  // send even if the text body is empty. Without this, Enter would silently
  // do nothing for an attachment-only message.
  canSendEmpty: boolean;
  onSend: (content: string) => void;
  onInputChange: (content: string) => void;
  onPaste: (e: React.ClipboardEvent) => void;
  selectedCounts: ChatSpaceSelectionCounts;
  onSelectNotebookPicker: () => void;
  onSelectBookPicker: () => void;
  onSelectHistoryPicker: () => void;
  onSelectQuestionBankPicker: () => void;
  onSelectSkillsPicker: () => void;
  onSelectMemoryPicker: () => void;
  /** 「空间」@ 引用菜单可见项；为空时输入 @ 不再弹菜单（财问裁剪） */
  spaceKeys: readonly SelectableSpaceKey[];
}

export interface ComposerInputHandle {
  clear: () => void;
  getValue: () => string;
}

export function shouldOpenAtPopup(value: string, cursorPos: number): boolean {
  const prefix = value.slice(0, cursorPos);
  return /(^|\s)@[^\s]*$/.test(prefix);
}

export function stripTrailingAtMention(value: string): string {
  return value.replace(/(^|\s)@[^\s]*$/, "$1").replace(/\s+$/, "");
}

export const ComposerInput = memo(
  forwardRef<ComposerInputHandle, ComposerInputProps>(function ComposerInput(
    {
      textareaRef,
      activeCapabilityKey,
      isMathAnimatorMode,
      isVisualizeMode,
      canSendEmpty,
      onSend,
      onInputChange,
      onPaste,
      selectedCounts,
      onSelectNotebookPicker,
      onSelectBookPicker,
      onSelectHistoryPicker,
      onSelectQuestionBankPicker,
      onSelectSkillsPicker,
      onSelectMemoryPicker,
      spaceKeys,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const [input, setInput] = useState("");
    const [showAtPopup, setShowAtPopup] = useState(false);

    // Latest text mirrored into a ref by the change handlers (never updated
    // during render). The @space handlers and the imperative handle read
    // from this ref so their identities stay stable across keystrokes,
    // letting `memo` on ChatSpaceMenu actually skip re-renders when
    // `showAtPopup` doesn't change.
    const inputRef = useRef("");
    const isComposingRef = useRef(false);
    // Helper that always updates state and ref together so they can't drift.
    const setInputBoth = useCallback((value: string) => {
      inputRef.current = value;
      setInput(value);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        clear: () => {
          setInputBoth("");
          onInputChange("");
        },
        getValue: () => inputRef.current,
      }),
      [setInputBoth, onInputChange],
    );

    useLayoutEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      // 自适应高度：先归零再测 scrollHeight（它取 max(内容高, 客户区高)，
      // 不归零会被旧高度托底）。
      // ⚠️ 不要给 height 加 CSS transition（如 height 0.15s ease-out）：
      // 归零设置与 scrollHeight 读取在同一帧内，过渡起始值仍是旧的大高度，
      // 客户区高度被钉住 → 输入框只涨不缩。要动画就得在测量期间临时
      // transition:"none" 并 void el.offsetHeight 提交后再恢复，得不偿失，
      // 直接即时伸缩即可。
      el.style.height = "28px";
      const next = Math.max(el.scrollHeight, 28);
      const bounded = Math.min(next, 200);
      el.style.height = `${bounded}px`;
      el.style.overflowY = next > 200 ? "auto" : "hidden";
    }, [input, activeCapabilityKey, textareaRef]);

    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value;
        const cursorPos = e.target.selectionStart ?? value.length;
        setInputBoth(value);
        onInputChange(value);
        // 财问裁剪：无可引用项时 @ 不弹菜单
        setShowAtPopup(spaceKeys.length > 0 && shouldOpenAtPopup(value, cursorPos));
      },
      [setInputBoth, onInputChange, spaceKeys.length],
    );

    const handleTextareaClick = useCallback(
      (e: React.MouseEvent<HTMLTextAreaElement>) => {
        if (spaceKeys.length === 0) return;
        const target = e.currentTarget;
        setShowAtPopup(
          shouldOpenAtPopup(
            target.value,
            target.selectionStart ?? target.value.length,
          ),
        );
      },
      [spaceKeys.length],
    );

    const doSend = useCallback(() => {
      const content = inputRef.current.trim();
      // Allow sending when text is empty but the parent has attachments or
      // references queued (canSendEmpty). This matches the send-button's
      // own enablement logic in ChatComposer (`canSend`).
      if (!content && !canSendEmpty) return;
      onSend(content);
      setInputBoth("");
      onInputChange("");
      setShowAtPopup(false);
    }, [canSendEmpty, onSend, setInputBoth, onInputChange]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (shouldSubmitOnEnter(e, isComposingRef.current)) {
          e.preventDefault();
          doSend();
        } else if (e.key === "Escape") {
          setShowAtPopup(false);
        }
      },
      [doSend],
    );

    const handleCompositionStart = useCallback(() => {
      isComposingRef.current = true;
    }, []);

    const handleCompositionEnd = useCallback(() => {
      // Some IMEs fire compositionend before the Enter keydown that confirms
      // a candidate, so keep the guard through the current event turn.
      setTimeout(() => {
        isComposingRef.current = false;
      }, 0);
    }, []);

    const clearTrailingMention = useCallback(() => {
      const next = stripTrailingAtMention(inputRef.current);
      setInputBoth(next);
      onInputChange(next);
    }, [setInputBoth, onInputChange]);

    const handleSelectSpaceItem = useCallback(
      (
        key:
          | "chat_history"
          | "books"
          | "notebooks"
          | "question_bank"
          | "skills"
          | "memory",
      ) => {
        clearTrailingMention();
        setShowAtPopup(false);
        if (key === "chat_history") onSelectHistoryPicker();
        else if (key === "books") onSelectBookPicker();
        else if (key === "notebooks") onSelectNotebookPicker();
        else if (key === "question_bank") onSelectQuestionBankPicker();
        else if (key === "skills") onSelectSkillsPicker();
        else if (key === "memory") onSelectMemoryPicker();
      },
      [
        clearTrailingMention,
        onSelectHistoryPicker,
        onSelectBookPicker,
        onSelectNotebookPicker,
        onSelectQuestionBankPicker,
        onSelectSkillsPicker,
        onSelectMemoryPicker,
      ],
    );

    return (
      <div className="px-4 pt-3.5 pb-2">
        {showAtPopup && (
          <div className="absolute bottom-full left-0 z-[70] mb-2">
            <ChatSpaceMenu
              variant="mention"
              selectedCounts={selectedCounts}
              enabledKeys={spaceKeys}
              onSelectItem={handleSelectSpaceItem}
            />
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onClick={handleTextareaClick}
          onPaste={onPaste}
          rows={1}
          suppressHydrationWarning
          placeholder={
            isMathAnimatorMode
              ? t("Describe the math animation or storyboard you want...")
              : isVisualizeMode
                ? t("Describe the chart or diagram you want to visualize...")
                : t("How can I help you today?")
          }
          className="w-full resize-none overflow-hidden bg-transparent text-[15px] leading-relaxed text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
          style={{ minHeight: 28 }}
        />
      </div>
    );
  }),
);
