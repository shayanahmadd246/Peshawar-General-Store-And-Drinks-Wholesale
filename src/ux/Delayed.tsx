import React, { useEffect, useState } from 'react';

/** Avoid flashy loaders for fast requests — children appear only after `ms`. */
export function Delayed({
  show,
  ms = 220,
  children,
}: {
  show: boolean;
  ms?: number;
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!show) {
      setVisible(false);
      return;
    }
    const t = window.setTimeout(() => setVisible(true), ms);
    return () => window.clearTimeout(t);
  }, [show, ms]);

  if (!show || !visible) return null;
  return <>{children}</>;
}
