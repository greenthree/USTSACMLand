import '@testing-library/jest-dom/vitest'

class TestResizeObserver implements ResizeObserver {
  disconnect() {}

  observe() {}

  unobserve() {}
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = TestResizeObserver
}

if (!HTMLElement.prototype.scrollTo) {
  HTMLElement.prototype.scrollTo = () => undefined
}
