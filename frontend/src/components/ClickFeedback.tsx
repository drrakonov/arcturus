import { useEffect } from 'react';

// Keep a brief pressed highlight after pointer or keyboard activation, even on fast responses.
export function ClickFeedback() {
  useEffect(() => {
    const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
    const click = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>('button, a[href]') : null;
      if (!element || element.matches(':disabled')) return;
      clearTimeout(timers.get(element));
      element.dataset.clicked = 'true';
      timers.set(element, setTimeout(() => { delete element.dataset.clicked; timers.delete(element); }, 450));
    };
    document.addEventListener('click', click, true);
    return () => {
      document.removeEventListener('click', click, true);
      timers.forEach((timer, element) => { clearTimeout(timer); delete element.dataset.clicked; });
    };
  }, []);
  return null;
}
