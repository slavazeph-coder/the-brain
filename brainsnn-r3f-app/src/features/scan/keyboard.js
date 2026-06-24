export function isKeyboardScanShortcut(event) {
  return (event.metaKey || event.ctrlKey) && event.key === 'Enter';
}
