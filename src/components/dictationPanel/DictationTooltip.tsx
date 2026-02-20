import { useState } from "react";

export function DictationTooltip({
  children,
  content,
}: {
  children: React.ReactNode;
  content: string;
}) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative inline-block">
      <div onMouseEnter={() => setIsVisible(true)} onMouseLeave={() => setIsVisible(false)}>
        {children}
      </div>
      {isVisible && (
        <div
          className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-1 py-1 text-popover-foreground bg-popover border border-border rounded-md whitespace-nowrap z-10 transition-opacity duration-150 shadow-lg"
          style={{ fontSize: "9.7px", maxWidth: "96px" }}
        >
          {content}
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-2 border-r-2 border-t-2 border-transparent border-t-popover"></div>
        </div>
      )}
    </div>
  );
}

