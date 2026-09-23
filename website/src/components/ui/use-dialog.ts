import { useEffect, useRef } from "react";

/**
 * 弹层的键盘与读屏基本功。Studio 的弹层此前只是几个 `fixed inset-0` 的 div：
 *  - 读屏软件不知道这是个对话框，也不知道它盖住了下面的内容；
 *  - 打开后焦点还留在背后的页面上，Tab 会一路跑到被遮住的按钮上（看不见的东西被"点"到）；
 *  - 关掉之后焦点丢到 body，键盘用户要从头 Tab 回原处（打开时原按钮就被重渲染掉的情况还原不了，见下）。
 *
 * 用法：把返回的 ref 挂到**面板**（不是遮罩）上，并给面板加 role="dialog" aria-modal="true" aria-label。
 * `onEscape` 传了才接管 Esc——RunViewer 这类自己已经处理 Esc 的，别传，免得一次按键关两层。
 */
export function useDialog(opts: { onEscape?: () => void; enabled?: boolean } = {}) {
  const { onEscape, enabled = true } = opts;
  const ref = useRef<HTMLDivElement>(null);
  // 用 ref 存回调：onEscape 多半是行内箭头函数，每次渲染都变；放进依赖会让 effect 每帧重装，
  // 初始焦点也就被反复抢回去（用户刚点进输入框就被拽走）。
  const escRef = useRef(onEscape);
  escRef.current = onEscape;

  useEffect(() => {
    const panel = ref.current;
    if (!enabled || !panel) return;
    const previous = document.activeElement as HTMLElement | null;

    const focusables = () =>
      [...panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((el) => el.offsetParent !== null || el === document.activeElement);

    // 初始焦点：面板里第一个能聚焦的；一个都没有就聚焦面板本身（读屏才会念出标题）。
    // 已经在面板里的话不动——避免把用户刚点的那个输入框抢走。
    if (!panel.contains(document.activeElement)) {
      const first = focusables()[0];
      if (first) first.focus();
      else { panel.tabIndex = -1; panel.focus(); }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && escRef.current) {
        e.stopPropagation();
        escRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // 焦点跑到面板外（背后的页面）也拉回来——不然 Tab 一路点到被遮住的按钮上
      if (!panel.contains(active)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
      if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      // 关掉后把焦点还回打开它的那个元素（键盘用户不用从头 Tab 回来）。
      // 打开弹层时若外层列表整块重渲染、原按钮节点被替换，这里拿到的就是 body——那就什么都不做，
      // 不假装还原（实测：从工作流卡片打开运行弹窗正是这种情况）。
      if (previous && previous !== document.body && document.contains(previous)) previous.focus();
    };
  }, [enabled]);

  return ref;
}
