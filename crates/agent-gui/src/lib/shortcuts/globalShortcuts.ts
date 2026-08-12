import { invoke } from "@tauri-apps/api/core";

/**
 * 全局快捷键（桌面端专属能力）。
 * 绑定只存本机 localStorage —— 快捷键是设备偏好，不进入设置同步/网关。
 * accelerator 采用 `Ctrl+Shift+KeyA` 形式：修饰键用 Ctrl/Shift/Alt/Super，
 * 主键用 W3C KeyboardEvent.code 名称，两端（前端录制 & Rust global_hotkey 解析）天然一致。
 */

export type GlobalShortcutAction = "toggle" | "newChat" | "pin";

export const GLOBAL_SHORTCUT_ACTIONS: readonly GlobalShortcutAction[] = [
  "toggle",
  "newChat",
  "pin",
];

/** 显示/隐藏与快速呼出合并后的固定系统全局热键。 */
export const WINDOW_TOGGLE_ACCELERATOR = "F2";

export interface GlobalShortcutBinding {
  accelerator: string;
  enabled: boolean;
}

export type GlobalShortcutBindings = Partial<Record<GlobalShortcutAction, GlobalShortcutBinding>>;

export interface GlobalShortcutFailure {
  action: string;
  accelerator: string;
  error: string;
}

const STORAGE_KEY = "liveagent.globalShortcuts.v1";

export const SHORTCUT_MODIFIER_ORDER = ["Ctrl", "Shift", "Alt", "Super"] as const;
export type ShortcutModifier = (typeof SHORTCUT_MODIFIER_ORDER)[number];

const MODIFIER_SET = new Set<string>(SHORTCUT_MODIFIER_ORDER);

function fixedWindowToggleBinding(): GlobalShortcutBinding {
  return { accelerator: WINDOW_TOGGLE_ACCELERATOR, enabled: true };
}

function isFixedWindowToggleAccelerator(accelerator: string): boolean {
  return accelerator.trim().toUpperCase() === WINDOW_TOGGLE_ACCELERATOR;
}

export function isShortcutModifierToken(token: string): token is ShortcutModifier {
  return MODIFIER_SET.has(token);
}

/** KeyboardEvent.code -> 修饰键 token；非修饰键返回 null。 */
export function modifierFromEventCode(code: string): ShortcutModifier | null {
  switch (code) {
    case "ControlLeft":
    case "ControlRight":
      return "Ctrl";
    case "ShiftLeft":
    case "ShiftRight":
      return "Shift";
    case "AltLeft":
    case "AltRight":
      return "Alt";
    case "MetaLeft":
    case "MetaRight":
      return "Super";
    default:
      return null;
  }
}

export function readGlobalShortcutBindings(): GlobalShortcutBindings {
  const bindings: GlobalShortcutBindings = { toggle: fixedWindowToggleBinding() };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return bindings;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return bindings;
    for (const action of GLOBAL_SHORTCUT_ACTIONS) {
      // toggle 已合并为固定 F2；忽略旧版本保存的 summon/toggle 自定义值。
      if (action === "toggle") continue;
      const value = (parsed as Record<string, unknown>)[action];
      // 早期版本直接存 accelerator 字符串，读取时迁移为 {accelerator, enabled}。
      if (typeof value === "string" && value.trim()) {
        const accelerator = value.trim();
        if (!isFixedWindowToggleAccelerator(accelerator)) {
          bindings[action] = { accelerator, enabled: true };
        }
        continue;
      }
      if (value && typeof value === "object") {
        const accelerator = (value as Record<string, unknown>).accelerator;
        const enabled = (value as Record<string, unknown>).enabled;
        if (
          typeof accelerator === "string" &&
          accelerator.trim() &&
          !isFixedWindowToggleAccelerator(accelerator)
        ) {
          bindings[action] = { accelerator: accelerator.trim(), enabled: enabled !== false };
        }
      }
    }
    return bindings;
  } catch {
    return bindings;
  }
}

export function writeGlobalShortcutBindings(bindings: GlobalShortcutBindings): void {
  try {
    const persisted: GlobalShortcutBindings = { toggle: fixedWindowToggleBinding() };
    for (const action of GLOBAL_SHORTCUT_ACTIONS) {
      if (action === "toggle") continue;
      const binding = bindings[action];
      if (binding && !isFixedWindowToggleAccelerator(binding.accelerator)) {
        persisted[action] = binding;
      }
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // localStorage 不可用时静默忽略（例如隐私模式）。
  }
}

/**
 * 把绑定应用到 Tauri 端（全量替换式注册，仅注册已启用的绑定）。
 * 固定窗口热键的 F2 不变量在注册入口强制执行，调用方无法移除、停用或改键。
 * 返回注册失败的条目；非 Tauri 环境（纯浏览器 dev）返回空数组。
 */
export async function applyGlobalShortcuts(
  bindings: GlobalShortcutBindings,
): Promise<GlobalShortcutFailure[]> {
  const effectiveBindings: GlobalShortcutBindings = {
    ...bindings,
    toggle: fixedWindowToggleBinding(),
  };
  const payload = GLOBAL_SHORTCUT_ACTIONS.flatMap((action) => {
    const binding = effectiveBindings[action];
    const accelerator = binding?.accelerator.trim();
    if (!binding?.enabled || !accelerator) return [];
    if (action !== "toggle" && isFixedWindowToggleAccelerator(accelerator)) return [];
    return [{ action, accelerator }];
  });
  try {
    const failures = await invoke<GlobalShortcutFailure[]>("app_set_global_shortcuts", {
      bindings: payload,
    });
    return Array.isArray(failures) ? failures : [];
  } catch {
    // 非 Tauri 环境或旧版桌面壳：忽略。
    return [];
  }
}

/** 应用启动时注册固定 F2，并恢复其余本机全局快捷键。 */
export async function applyStoredGlobalShortcuts(): Promise<void> {
  await applyGlobalShortcuts(readGlobalShortcutBindings());
}
