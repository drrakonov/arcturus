import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { StaticGalaxy } from './StaticGalaxy';
gsap.registerPlugin(ScrollTrigger);

export function Galaxy({ paused, journey }: { paused: boolean; journey: RefObject<HTMLElement | null> }) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (paused) { setReady(false); return; }
    let cancelled = false, cleanup = () => {};
    // Load the renderer only on the landing page and only when motion is enabled.
    void import('three').then(T => {
      if (cancelled || !host.current) return;
      const container = host.current;
      let renderer: InstanceType<typeof T.WebGLRenderer>;
      try { renderer = new T.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' }); }
      catch { return; } // Keep the static galaxy if WebGL is unavailable.
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      renderer.domElement.className = 'galaxy-webgl';
      container.appendChild(renderer.domElement);
      const scene = new T.Scene();
      const camera = new T.PerspectiveCamera(55, 1, .1, 180);
      const group = new T.Group(); scene.add(group);
      const geometries: InstanceType<typeof T.BufferGeometry>[] = [];
      const materials: InstanceType<typeof T.Material>[] = [];
      let seed = 4096;
      const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const textureCanvas = document.createElement('canvas'); textureCanvas.width = textureCanvas.height = 64;
      const ctx = textureCanvas.getContext('2d')!;
      const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      glow.addColorStop(0, '#fff'); glow.addColorStop(.12, '#fffffff0'); glow.addColorStop(.4, '#ffffff25'); glow.addColorStop(1, '#ffffff00');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, 64, 64);
      const texture = new T.CanvasTexture(textureCanvas);
      const mobile = window.matchMedia('(max-width:700px)').matches;
      for (const field of [false, true]) {
        const count = field ? 1300 : mobile ? 11000 : 22000;
        const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          const radius = Math.pow(random(), .7) * 17;
          const angle = (i % 4) * Math.PI / 2 + radius * .38 + (random() - .5) * .5;
          positions[i * 3] = field ? (random() - .5) * 100 : Math.cos(angle) * radius + (random() - .5) * .65;
          positions[i * 3 + 1] = field ? (random() - .5) * 70 : (random() - .5) * (1.2 - radius * .035);
          positions[i * 3 + 2] = field ? (random() - .5) * 100 : Math.sin(angle) * radius + (random() - .5) * .65;
          const color = new T.Color(radius < 4 && !field ? '#ffd4a5' : '#9db8ed');
          color.multiplyScalar(.4 + random() * .65); color.toArray(colors, i * 3);
        }
        const geometry = new T.BufferGeometry();
        geometry.setAttribute('position', new T.BufferAttribute(positions, 3)); geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
        const material = new T.PointsMaterial({ size: field ? .14 : .19, map: texture, vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false });
        const points = new T.Points(geometry, material);
        (field ? scene : group).add(points); geometries.push(geometry); materials.push(material);
      }
      const coreMaterial = new T.SpriteMaterial({ map: texture, color: '#ffd3a0', transparent: true, blending: T.AdditiveBlending, depthWrite: false });
      const core = new T.Sprite(coreMaterial); core.scale.set(5, 5, 1); group.add(core); materials.push(coreMaterial);
      group.rotation.z = -.25;
      const travel = { value: 0 }, pointer = { x: 0, y: 0 };
      const tween = gsap.to(travel, { value: 1, ease: 'none', scrollTrigger: { trigger: journey.current, start: 'top top', end: 'bottom bottom', scrub: .8 } });
      const resize = () => { const { width, height } = container.getBoundingClientRect(); renderer.setSize(width, height); camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix(); };
      const observer = new ResizeObserver(resize); observer.observe(container); resize();
      const move = (event: PointerEvent) => { if (event.pointerType !== 'mouse') return; pointer.x = (event.clientX / innerWidth - .5) * 1.6; pointer.y = (event.clientY / innerHeight - .5) * .8; };
      const leave = () => { pointer.x = pointer.y = 0; };
      window.addEventListener('pointermove', move); document.addEventListener('pointerleave', leave);
      let intersecting = true, previous = 0, driftX = 0, driftY = 0;
      const visible = new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; scheduling(); }); visible.observe(container);
      const frame = (time: number) => {
        if (time - previous < 1000 / 30) return; previous = time;
        const p = travel.value;
        driftX += (pointer.x - driftX) * .08; driftY += (pointer.y - driftY) * .08;
        camera.position.set(1 + p * 6 + driftX, 18 - p * 14 + driftY, 29 - p * 22);
        camera.lookAt(mobile ? 0 : -7 + p * 9, 0, -p * 3);
        group.rotation.y = p * .8 + time * .000008;
        renderer.render(scene, camera);
        container.dataset.travel = p.toFixed(2);
      };
      function scheduling() { renderer.setAnimationLoop(!document.hidden && intersecting ? frame : null); }
      document.addEventListener('visibilitychange', scheduling); scheduling();
      const lost = (event: Event) => { event.preventDefault(); setReady(false); renderer.setAnimationLoop(null); };
      renderer.domElement.addEventListener('webglcontextlost', lost);
      setReady(true);
      cleanup = () => {
        renderer.setAnimationLoop(null); tween.scrollTrigger?.kill(); tween.kill(); observer.disconnect(); visible.disconnect();
        window.removeEventListener('pointermove', move); document.removeEventListener('pointerleave', leave); document.removeEventListener('visibilitychange', scheduling);
        renderer.domElement.removeEventListener('webglcontextlost', lost);
        geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); texture.dispose(); renderer.dispose(); renderer.domElement.remove();
      };
    }).catch(() => setReady(false));
    return () => { cancelled = true; cleanup(); };
  }, [paused, journey]);
  return <div className="galaxy-scene" data-renderer={ready ? 'webgl' : 'static'} aria-hidden="true">
    <div className="galaxy-fallback" style={{ opacity: ready ? 0 : 1 }}><StaticGalaxy paused/></div>
    <div ref={host} className="galaxy-renderer" style={{ opacity: ready ? 1 : 0 }}/>
  </div>;
}
