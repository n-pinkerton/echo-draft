export const focusSettingsTarget = (
  targetId: string,
  documentRef: Document = document
): boolean => {
  const target = documentRef.getElementById(targetId);
  if (!target) return false;
  target.scrollIntoView?.({ behavior: "smooth", block: "start" });
  target.focus({ preventScroll: true });
  return true;
};
