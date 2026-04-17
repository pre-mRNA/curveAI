import type { ReactNode } from 'react';

type PublicFactTone = 'default' | 'accent' | 'good' | 'warn';

export type PublicFact = {
  label: string;
  value: ReactNode;
  tone?: PublicFactTone;
};

function joinClasses(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(' ');
}

export function PublicActionCard(props: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { eyebrow, title, description, children, className } = props;
  return (
    <section className={joinClasses('public-card public-card--action', className)}>
      {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
      <h2>{title}</h2>
      {description ? <p className="muted public-card-description">{description}</p> : null}
      <div className="public-card-body">{children}</div>
    </section>
  );
}

export function PublicSidePanel(props: {
  eyebrow?: string;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { eyebrow, title, children, className } = props;
  return (
    <section className={joinClasses('public-card public-card--support', className)}>
      {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
      <h3>{title}</h3>
      <div className="public-card-body">{children}</div>
    </section>
  );
}

export function PublicFactStrip(props: {
  facts: PublicFact[];
  className?: string;
}) {
  const { facts, className } = props;
  return (
    <div className={joinClasses('public-fact-strip', className)}>
      {facts.map((fact) => (
        <div className="public-fact" key={fact.label}>
          <span className="muted">{fact.label}</span>
          <strong className={fact.tone ? `public-fact-value public-fact-value--${fact.tone}` : 'public-fact-value'}>
            {fact.value}
          </strong>
        </div>
      ))}
    </div>
  );
}

export function PublicMiniSteps(props: {
  steps: Array<{ id: string; title: ReactNode; detail: ReactNode }>;
  className?: string;
}) {
  const { steps, className } = props;
  return (
    <div className={joinClasses('public-mini-steps', className)}>
      {steps.map((step, index) => (
        <div className="public-mini-step" key={step.id}>
          <span className="public-mini-step-index">{index + 1}</span>
          <div>
            <strong>{step.title}</strong>
            <div className="muted">{step.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
