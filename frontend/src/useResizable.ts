import { useCallback, useRef, useState } from 'react'

interface UseResizableOptions {
  axis: 'x' | 'y'
  // 1 if the panel grows as the pointer moves in the positive axis
  // direction (e.g. a left-anchored sidebar growing rightward); -1 if it
  // grows in the opposite direction (a right- or bottom-anchored panel).
  direction?: 1 | -1
  min?: number
  max?: number
}

export function useResizable(initial: number, { axis, direction = 1, min = 0, max = Infinity }: UseResizableOptions) {
  const [size, setSize] = useState(initial)
  const sizeRef = useRef(size)
  sizeRef.current = size

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startPos = axis === 'x' ? e.clientX : e.clientY
      const startSize = sizeRef.current

      function onMove(ev: MouseEvent) {
        const pos = axis === 'x' ? ev.clientX : ev.clientY
        const delta = (pos - startPos) * direction
        setSize(Math.min(max, Math.max(min, startSize + delta)))
      }
      function onUp() {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      // Set on body (not just the handle) so the cursor stays correct even
      // when the pointer briefly moves over the editor/panels mid-drag.
      document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [axis, direction, min, max],
  )

  return { size, onDragStart }
}
