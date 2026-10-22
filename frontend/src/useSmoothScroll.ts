import { useEffect } from 'react';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

export function useSmoothScroll() {
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let lenis: Lenis | undefined;
    const update = () => {
      lenis?.destroy(); lenis = undefined;
      if (!preference.matches) lenis = new Lenis({ autoRaf: true, anchors: true, duration: .85,
        prevent: element => element.hasAttribute('data-native-scroll') });
    };
    update(); preference.addEventListener('change', update);
    return () => { preference.removeEventListener('change', update); lenis?.destroy(); };
  }, []);
}
