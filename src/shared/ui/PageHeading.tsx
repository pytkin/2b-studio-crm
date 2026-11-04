import type { ReactNode } from 'react';

export function PageHeading({
  children,
  eyebrow,
  actions,
}: {
  children: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 tabIndex={-1}>{children}</h1>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
