import { useEffect, useRef } from 'react';
import gsap from 'gsap';

/** Decorative, procedurally drawn galaxy; no images, video downloads or WebGL dependency. */
export function StaticGalaxy({ paused }: { paused: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current!;
    const context = element.getContext('2d');
    if (!context) return;
    const draw = () => {
      const width = element.clientWidth, height = element.clientHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      element.width = width * ratio; element.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      let seed = 420;
      const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      for (let i = 0; i < Math.min(width * height / 1100, 1400); i++) {
        const x = random() * width, y = random() * height, radius = random() * .9 + .2;
        context.fillStyle = `rgba(205,215,241,${random() * .6 + .1})`;
        context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
      }
      context.save();
      context.translate(width * (width < 700 ? .59 : .66), height * .46);
      context.rotate(-.32);
      context.scale(1, .53);
      const size = Math.min(width * .56, 740);
      const halo = context.createRadialGradient(0, 0, 0, 0, 0, size);
      halo.addColorStop(0, '#e8b78760'); halo.addColorStop(.1, '#b3c4ee30');
      halo.addColorStop(.45, '#63769d12'); halo.addColorStop(1, '#0b0d1400');
      context.fillStyle = halo; context.fillRect(-size, -size, size * 2, size * 2);
      // Four spiral arms with dispersed stars and a dense, warm central bulge.
      for (let i = 0; i < 18000; i++) {
        const radius = Math.pow(random(), .7) * size;
        const arm = Math.floor(random() * 4) * Math.PI / 2;
        const angle = arm + radius / size * 7 + (random() - .5) * (.3 + radius / size * .65);
        const scatter = (random() - .5) * size * .08;
        const x = Math.cos(angle) * radius + scatter;
        const y = Math.sin(angle) * radius + (random() - .5) * size * .07;
        const alpha = (.12 + random() * .55) * (1 - radius / size * .8);
        context.fillStyle = radius < size * .2 ? `rgba(244,211,178,${alpha})` : `rgba(169,191,233,${alpha})`;
        context.beginPath(); context.arc(x, y, random() * 1.05 + .15, 0, Math.PI * 2); context.fill();
      }
      const core = context.createRadialGradient(0, 0, 0, 0, 0, size * .12);
      core.addColorStop(0, '#fff0dbe0'); core.addColorStop(.2, '#f6cda17a'); core.addColorStop(1, '#f6cda100');
      context.fillStyle = core; context.fillRect(-size * .12, -size * .12, size * .24, size * .24);
      context.restore();
    };
    const observer = new ResizeObserver(draw); observer.observe(element);
    draw();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (paused) return;
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const tween = gsap.to(canvas.current, { rotation: 2, scale: 1.045, duration: 35, repeat: -1, yoyo: true, ease: 'sine.inOut' });
      const visibility = () => document.hidden ? tween.pause() : tween.resume();
      visibility(); document.addEventListener('visibilitychange', visibility);
      return () => document.removeEventListener('visibilitychange', visibility);
    });
    return () => media.revert();
  }, [paused]);
  return <canvas className="galaxy-canvas" ref={canvas} aria-hidden="true"/>;
}
