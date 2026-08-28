interface ScrollVirtualizerInstance {
  scrollElement: HTMLElement | null;
}

interface VirtualizerRect {
  width: number;
  height: number;
}

export function observeVirtualizerElementRect(
  instance: ScrollVirtualizerInstance,
  callback: (rect: VirtualizerRect) => void,
): (() => void) | undefined {
  const element = instance.scrollElement;
  if (!element) return undefined;
  const report = () => {
    const rect = element.getBoundingClientRect();
    callback({ width: rect.width || 900, height: rect.height || 360 });
  };
  report();
  if (typeof ResizeObserver === 'undefined') return undefined;
  const observer = new ResizeObserver(report);
  observer.observe(element);
  return () => observer.disconnect();
}
