import { type ReactNode, useEffect, useRef } from 'react';

export function PageHeading({
  children,
  eyebrow,
  actions,
}: {
  children: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 ref={heading} tabIndex={-1}>
          {children}
        </h1>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
