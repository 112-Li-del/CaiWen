"use client";

/**
 * React Bits `BranchedMenu` 移植件（财问会话列表用）。
 *
 * 相比原版改动：
 * 1. **TypeScript 化**：items / actions / props 加类型。
 * 2. **去掉 hugeicons 依赖**：renderIcon 只接受 React 元素（isValidElement），
 *    财问传 lucide 图标元素即可，不引入新包。
 * 3. **子项更多菜单**：子项支持 `actions`，hover 时右侧显示"…"按钮，
 *    点击弹出下拉菜单（重命名 / 删除等）。菜单通过 **createPortal 渲染到
 *    document.body + fixed 定位**，自动判断向上/向下弹出，不会被滚动容器
 *    overflow 裁剪；滚动、resize、点击外部时关闭。
 * 4. **重命名编辑态**：`editingValue` 受控，对应子项渲染 input，回车/失焦
 *    提交，Esc 取消。
 * 5. **active 受控**：传 `active` 时由外部控制选中态（会话切换同步）。
 */

import {
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import "./BranchedMenu.css";

export interface BranchedMenuAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

export interface BranchedMenuItem {
  value: string;
  label: string;
  icon?: ReactNode;
  actions?: BranchedMenuAction[];
}

export interface BranchedMenuSection {
  label: string;
  children: BranchedMenuItem[];
}

export interface BranchedMenuProps {
  items: BranchedMenuSection[];
  defaultOpen?: number | number[];
  defaultActive?: string;
  /** 受控选中值（传了则优先用外部值） */
  active?: string;
  onSelect?: (value: string, item: BranchedMenuItem) => void;
  onToggle?: (index: number, open: boolean) => void;
  /** 正在重命名的子项 value */
  editingValue?: string | null;
  onRenameSubmit?: (value: string, newTitle: string) => void;
  onRenameCancel?: () => void;
  color?: string;
  accentColor?: string;
  lineColor?: string;
  width?: number;
  rowHeight?: number;
  indent?: number;
  trunk?: number;
  radius?: number;
  lineWidth?: number;
  fontSize?: number;
  drawDuration?: number;
  foldDuration?: number;
  className?: string;
}

const PAD = 6;
const MARK = 16;
const MENU_W = 120;
const MENU_ROW_H = 32;

const renderIcon = (icon: ReactNode) =>
  isValidElement(icon) ? icon : null;

const toSet = (open: number | number[]) =>
  new Set(Array.isArray(open) ? open : open >= 0 ? [open] : []);

export default function BranchedMenu({
  items,
  defaultOpen = 0,
  defaultActive = "",
  active: activeProp,
  onSelect,
  onToggle,
  editingValue = null,
  onRenameSubmit,
  onRenameCancel,
  color = "#f5f5f5",
  accentColor = "#f5f5f5",
  lineColor = "#3f3f46",
  width = 240,
  rowHeight = 36,
  indent = 40,
  trunk = 14,
  radius = 10,
  lineWidth = 1.5,
  fontSize = 14,
  drawDuration = 400,
  foldDuration = 300,
  className = "",
}: BranchedMenuProps) {
  const [open, setOpen] = useState<Set<number>>(() => toSet(defaultOpen));
  const [activeInternal, setActiveInternal] = useState(() => {
    if (defaultActive) return defaultActive;
    const first = items.find(
      (it, i) => it.children && toSet(defaultOpen).has(i),
    );
    return first?.children?.[0]?.value ?? "";
  });
  const active = activeProp ?? activeInternal;

  /* 更多菜单：portal + fixed 定位，避免被滚动容器裁剪 */
  const [menuState, setMenuState] = useState<{
    value: string;
    top: number;
    left: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const openMenuBtnRef = useRef<HTMLButtonElement | null>(null);

  const navRef = useRef<HTMLElement | null>(null);
  const heads = useRef<(HTMLButtonElement | null)[]>([]);
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const latest = useRef({ onSelect, onToggle });
  latest.current = { onSelect, onToggle };

  const activeSection = items.findIndex((it) =>
    it.children?.some((kid) => kid.value === active),
  );
  /* 只要有选中项，其所属分组标题旁就显示高亮条（含分组收起时） */
  const markerShown = activeSection >= 0;

  /* 打开更多菜单：fixed 坐标，自动判断向上/向下、左右不越界 */
  const openMenu = useCallback(
    (kid: BranchedMenuItem, e: ReactMouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (menuState?.value === kid.value) {
        setMenuState(null);
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      const itemCount = kid.actions?.length ?? 0;
      const menuH = itemCount * MENU_ROW_H + 10;
      const gap = 6;
      /* 优先向按钮右侧展开，不遮挡会话列表；右侧不够再回退左侧 */
      let left = rect.right + gap;
      if (left + MENU_W > window.innerWidth - 8) {
        left = Math.max(8, rect.left - MENU_W - gap);
      }
      /* 顶部与按钮对齐，超出视口底部则上收 */
      let top = rect.top;
      if (top + menuH > window.innerHeight - 8) {
        top = Math.max(8, window.innerHeight - menuH - 8);
      }
      openMenuBtnRef.current = e.currentTarget;
      setMenuState({ value: kid.value, top, left });
    },
    [menuState],
  );

  /* 点击外部 / 滚动 / resize 关闭菜单 */
  useEffect(() => {
    if (!menuState) return;
    const handleDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || openMenuBtnRef.current?.contains(t))
        return;
      setMenuState(null);
    };
    const close = () => setMenuState(null);
    document.addEventListener("mousedown", handleDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menuState]);

  useLayoutEffect(() => {
    const place = (glide: boolean) => {
      const m = markerRef.current;
      const el = heads.current[activeSection];
      if (!m) return;
      const on = markerShown && !!el;
      if (!glide) m.style.transition = "none";
      if (on && el)
        m.style.top = `${el.offsetTop + (el.offsetHeight - MARK) / 2}px`;
      m.toggleAttribute("data-on", on);
      if (!glide) {
        void m.offsetHeight;
        m.style.transition = "";
      }
    };
    place(true);
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      place(false);
    });
    if (navRef.current) ro.observe(navRef.current);
    return () => ro.disconnect();
  }, [activeSection, markerShown, items, fontSize, rowHeight]);

  const select = useCallback((value: string, item: BranchedMenuItem) => {
    setActiveInternal(value);
    latest.current.onSelect?.(value, item);
  }, []);

  const toggle = useCallback((i: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      const isOpen = !next.has(i);
      if (isOpen) next.add(i);
      else next.delete(i);
      latest.current.onToggle?.(i, isOpen);
      return next;
    });
  }, []);

  const r = Math.min(radius, rowHeight / 2 - 2);
  const endX = indent - 8;
  const rowY = (k: number) => PAD + k * rowHeight + rowHeight / 2;
  const branch = (k: number) =>
    `M ${trunk} ${rowY(k) - r} A ${r} ${r} 0 0 0 ${trunk + r} ${rowY(k)} H ${endX}`;
  const reach = (k: number) =>
    `M ${trunk} 0 V ${rowY(k) - r} A ${r} ${r} 0 0 0 ${trunk + r} ${rowY(k)} H ${endX}`;
  const length = (k: number) =>
    rowY(k) - r + (Math.PI * r) / 2 + (endX - trunk - r);

  /* portal 菜单内容 */
  const menuKid = menuState
    ? items
        .flatMap((s) => s.children ?? [])
        .find((k) => k.value === menuState.value)
    : null;

  return (
    <nav
      ref={navRef}
      className={`branched-menu${className ? ` ${className}` : ""}`}
      style={{
        ["--bm-w" as string]: `${width}px`,
        ["--bm-ink" as string]: color,
        ["--bm-accent" as string]: accentColor,
        ["--bm-line" as string]: lineColor,
        ["--bm-font" as string]: `${fontSize}px`,
        ["--bm-row" as string]: `${rowHeight}px`,
        ["--bm-indent" as string]: `${indent}px`,
        ["--bm-line-w" as string]: lineWidth,
        ["--bm-draw" as string]: `${drawDuration}ms`,
        ["--bm-fold" as string]: `${foldDuration}ms`,
      }}
    >
      <span
        ref={markerRef}
        className="branched-menu__marker"
        aria-hidden="true"
      />
      {items.map((item, i) => {
        const kids = item.children;
        const isOpen = kids ? open.has(i) : false;
        /* 该分组是否包含当前选中项（收起时标题也保持常亮） */
        const sectionHasActive = kids?.some((k) => k.value === active) ?? false;
        const bodyH = kids ? PAD * 2 + kids.length * rowHeight : 0;
        return (
          <div
            key={item.label}
            className="branched-menu__section"
            data-open={isOpen ? "" : undefined}
          >
            <button
              ref={(el) => {
                heads.current[i] = el;
              }}
              type="button"
              className="branched-menu__head"
              aria-expanded={kids ? isOpen : undefined}
              data-active={sectionHasActive ? "" : undefined}
              onClick={() => kids && toggle(i)}
            >
              {item.label}
            </button>
            {kids ? (
              <div className="branched-menu__body">
                <div className="branched-menu__fold">
                  <div
                    className="branched-menu__tree"
                    style={{ height: bodyH }}
                  >
                    <svg
                      className="branched-menu__lines"
                      width={indent}
                      height={bodyH}
                      aria-hidden="true"
                    >
                      <path
                        className="branched-menu__base"
                        d={`M ${trunk} 0 V ${rowY(kids.length - 1) - r}`}
                      />
                      {kids.map((kid, k) => (
                        <path
                          key={kid.value}
                          className="branched-menu__base"
                          d={branch(k)}
                        />
                      ))}
                      {kids.map((kid, k) => (
                        <path
                          key={kid.value}
                          className="branched-menu__reach"
                          d={reach(k)}
                          style={{
                            strokeDasharray: length(k),
                            strokeDashoffset:
                              kid.value === active ? 0 : length(k),
                          }}
                        />
                      ))}
                    </svg>
                    {kids.map((kid) => {
                      const isEditing = editingValue === kid.value;
                      const isActive = kid.value === active;
                      const menuOpen = menuState?.value === kid.value;
                      const hasActions =
                        !isEditing && kid.actions && kid.actions.length > 0;
                      return (
                        <div
                          key={kid.value}
                          className="branched-menu__item-wrap"
                        >
                          <button
                            type="button"
                            className={`branched-menu__item${
                              isActive ? " is-active" : ""
                            }`}
                            aria-current={isActive ? "true" : undefined}
                            data-active={isActive ? "" : undefined}
                            tabIndex={isOpen ? 0 : -1}
                            onClick={() =>
                              !isEditing && select(kid.value, kid)
                            }
                          >
                            {kid.icon ? (
                              <span
                                className="branched-menu__icon"
                                aria-hidden="true"
                              >
                                {renderIcon(kid.icon)}
                              </span>
                            ) : null}
                            {isEditing ? (
                              <input
                                className="branched-menu__rename-input"
                                defaultValue={kid.label}
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    onRenameSubmit?.(
                                      kid.value,
                                      (e.target as HTMLInputElement).value,
                                    );
                                  } else if (e.key === "Escape") {
                                    e.preventDefault();
                                    onRenameCancel?.();
                                  }
                                }}
                                onBlur={(e) =>
                                  onRenameSubmit?.(kid.value, e.target.value)
                                }
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <span className="branched-menu__label">
                                {kid.label}
                              </span>
                            )}
                          </button>
                          {hasActions && (
                            <button
                              type="button"
                              className={`branched-menu__more${
                                menuOpen ? " is-open" : ""
                              }`}
                              aria-label="更多操作"
                              onClick={(e) => openMenu(kid, e)}
                            >
                              <MoreHorizontal size={14} strokeWidth={2} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}

      {/* 更多菜单：portal 到 body，fixed 定位不被裁剪 */}
      {menuState &&
        menuKid?.actions &&
        createPortal(
          <div
            ref={menuRef}
            className="branched-menu__more-menu"
            style={{
              position: "fixed",
              top: menuState.top,
              left: menuState.left,
              width: MENU_W,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {menuKid.actions.map((action, ai) => (
              <button
                key={ai}
                type="button"
                className={`branched-menu__more-action${
                  action.danger ? " is-danger" : ""
                }`}
                onClick={() => {
                  setMenuState(null);
                  action.onClick();
                }}
              >
                {action.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </nav>
  );
}
