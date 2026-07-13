import type React from "react";

export function SettingsPanel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-border/50 dark:border-border-subtle/70 bg-card/50 dark:bg-surface-2/50 backdrop-blur-sm divide-y divide-border/30 dark:divide-border-subtle/50 ${className}`}
    >
      {children}
    </div>
  );
}

export function SettingsPanelRow({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`px-4 py-3 ${className}`}>{children}</div>;
}

export function SectionHeader({
  title,
  description,
  headingRef,
  headingId,
  headingTabIndex,
}: {
  title: string;
  description?: string;
  headingRef?: React.Ref<HTMLHeadingElement>;
  headingId?: string;
  headingTabIndex?: number;
}) {
  return (
    <div className="mb-3">
      <h3
        ref={headingRef}
        id={headingId}
        tabIndex={headingTabIndex}
        className="text-[13px] font-semibold text-foreground tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        {title}
      </h3>
      {description && (
        <p className="text-[11px] text-muted-foreground/80 mt-0.5 leading-relaxed">{description}</p>
      )}
    </div>
  );
}
