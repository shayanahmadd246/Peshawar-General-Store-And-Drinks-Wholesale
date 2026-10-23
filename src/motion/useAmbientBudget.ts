import { useEffect, useMemo, useState } from 'react';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

export type AmbientIntensity = 'landing' | 'chat' | 'commerce' | 'ops' | 'delivery';

export function useAmbientBudget(intensity: AmbientIntensity) {
  const reduced = usePrefersReducedMotion();
  const [hidden, setHidden] = useState(false);
  const [lowPower, setLowPower] = useState(false);

  useEffect(() => {
    const onVis = () => setHidden(document.visibilityState === 'hidden');
    onVis();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    const cores = navigator.hardwareConcurrency || 4;
    const mem = nav.deviceMemory || 4;
    const saveData = Boolean(nav.connection?.saveData);
    const mobile = window.matchMedia('(max-width: 768px)').matches;
    setLowPower(saveData || mem <= 4 || cores <= 4 || mobile);
  }, []);

  return useMemo(() => {
    if (reduced) {
      return {
        reduced: true,
        paused: true,
        particles: 0,
        links: false,
        mouse: false,
        beams: false,
        aurora: 'static' as const,
        dprCap: 1,
      };
    }

    const base = {
      landing: { particles: lowPower ? 55 : 96, links: true, mouse: true, beams: true, aurora: 'hot' as const },
      chat: { particles: lowPower ? 34 : 64, links: true, mouse: true, beams: true, aurora: 'cool' as const },
      commerce: { particles: lowPower ? 18 : 36, links: false, mouse: true, beams: false, aurora: 'warm' as const },
      ops: { particles: lowPower ? 12 : 24, links: false, mouse: false, beams: false, aurora: 'soft' as const },
      delivery: { particles: lowPower ? 8 : 16, links: false, mouse: false, beams: false, aurora: 'soft' as const },
    }[intensity];

    return {
      reduced: false,
      paused: hidden,
      ...base,
      dprCap: lowPower ? 1 : 1.5,
    };
  }, [hidden, intensity, lowPower, reduced]);
}
