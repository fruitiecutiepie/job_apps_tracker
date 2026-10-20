import { describe, expect, it } from 'vitest'
import { act, fireEvent, renderHook } from '@testing-library/react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import { usePointerDrag } from './usePointerDrag'

describe('usePointerDrag', () => {
  it('does not re-render while the pointer moves over the same target', () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      // A fresh object on every ask, as a hit test reading the document returns.
      return usePointerDrag<{ lane: string }>({ targetAt: () => ({ lane: 'offer' }), onDrop: () => {} })
    })

    const pointer = { pointerId: 1, pointerType: 'mouse', button: 0 }
    act(() => {
      result.current.start(
        { ...pointer, clientX: 0, clientY: 0, currentTarget: document.createElement('div') } as unknown as ReactPointerEvent<HTMLElement>,
        'card',
      )
    })
    act(() => {
      fireEvent.pointerMove(window, { ...pointer, clientX: 40, clientY: 0 })
    })
    expect(result.current.target).toEqual({ lane: 'offer' })

    const settled = renders
    act(() => {
      for (const x of [50, 60, 70, 80]) fireEvent.pointerMove(window, { ...pointer, clientX: x, clientY: 0 })
    })
    expect(renders).toBe(settled)
  })

  it('still follows the pointer onto a new target, whatever shape it has', () => {
    type Target =
      | { kind: 'slot'; groupId: string; index: number }
      | { kind: 'edge'; groupId: string; edge: string }
    // Over x the pointer is on: a slot, another slot in the same pane, then an edge of it.
    const at = (x: number): Target =>
      x < 60 ? { kind: 'slot', groupId: 'g', index: 0 }
        : x < 80 ? { kind: 'slot', groupId: 'g', index: 1 }
          : { kind: 'edge', groupId: 'g', edge: 'right' }
    const { result } = renderHook(() => usePointerDrag<Target>({ targetAt: at, onDrop: () => {} }))

    const pointer = { pointerId: 1, pointerType: 'mouse', button: 0 }
    act(() => {
      result.current.start(
        { ...pointer, clientX: 0, clientY: 0, currentTarget: document.createElement('div') } as unknown as ReactPointerEvent<HTMLElement>,
        'tab',
      )
    })
    const moveTo = (x: number) => act(() => {
      fireEvent.pointerMove(window, { ...pointer, clientX: x, clientY: 0 })
    })

    moveTo(40)
    expect(result.current.target).toEqual({ kind: 'slot', groupId: 'g', index: 0 })
    moveTo(70)
    expect(result.current.target).toEqual({ kind: 'slot', groupId: 'g', index: 1 })
    moveTo(90)
    expect(result.current.target).toEqual({ kind: 'edge', groupId: 'g', edge: 'right' })
  })
})
