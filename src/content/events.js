export function registerDocumentEvents({
  captureSelection,
  handleDocumentInput,
  handleDocumentKeyDown,
  handleDocumentPointerDown,
  handleDocumentClick
}) {
  document.addEventListener("selectionchange", () => {
    window.setTimeout(captureSelection, 60);
  });
  document.addEventListener("input", handleDocumentInput, true);
  document.addEventListener("keydown", handleDocumentKeyDown, true);
  document.addEventListener("pointerdown", handleDocumentPointerDown, true);
  document.addEventListener("click", handleDocumentClick, true);
}
