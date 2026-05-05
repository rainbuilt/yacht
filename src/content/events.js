export function registerDocumentEvents({
  captureSelection,
  handleDocumentInput,
  handleDocumentKeyDown,
  handleDocumentPointerDown,
  handleDocumentPointerMove,
  handleDocumentPointerUp,
  handleDocumentPointerCancel,
  handleDocumentClick
}) {
  document.addEventListener("selectionchange", () => {
    window.setTimeout(captureSelection, 60);
  });
  document.addEventListener("input", handleDocumentInput, true);
  document.addEventListener("keydown", handleDocumentKeyDown, true);
  document.addEventListener("pointerdown", handleDocumentPointerDown, true);
  document.addEventListener("pointermove", handleDocumentPointerMove, true);
  document.addEventListener("pointerup", handleDocumentPointerUp, true);
  document.addEventListener("pointercancel", handleDocumentPointerCancel, true);
  document.addEventListener("click", handleDocumentClick, true);
}
