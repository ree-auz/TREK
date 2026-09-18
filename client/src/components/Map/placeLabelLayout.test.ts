import { describe, expect, it } from 'vitest'
import { layoutPlaceLabels, type LabelLayoutItem } from './placeLabelLayout'

const item = (id: string, x: number, y: number, width = 80): LabelLayoutItem => ({
  id, anchor: { x, y }, iconRect: { x: x - 19, y: y - 37, width: 38, height: 38 },
  size: { width, height: 21 }, priority: 100, stableOrder: Number(id),
})

describe('place label screen-space layout', () => {
  it('keeps an isolated label bottom-centred', () => {
    const result = layoutPlaceLabels([item('1', 200, 150)], { x: 0, y: 0, width: 400, height: 300 })
    expect(result.placements.get('1')?.candidate).toBe('bottom')
  })

  it('shows both adjacent labels by using alternate candidates', () => {
    const result = layoutPlaceLabels([item('1', 170, 150, 110), item('2', 230, 150, 110)], { x: 0, y: 0, width: 400, height: 300 })
    expect(result.hidden.size).toBe(0)
    expect(result.placements.size).toBe(2)
    expect(result.placements.get('2')?.candidate).not.toBe('bottom')
  })

  it('restores bottom after zoom creates screen space', () => {
    const crowded = layoutPlaceLabels([item('1', 170, 150, 110), item('2', 230, 150, 110)], { x: 0, y: 0, width: 400, height: 300 })
    const expanded = [item('1', 100, 150, 110), item('2', 300, 150, 110)].map(i => ({ ...i, previousCandidate: crowded.placements.get(i.id)?.candidate }))
    const result = layoutPlaceLabels(expanded, { x: 0, y: 0, width: 400, height: 300 })
    expect([...result.placements.values()].map(p => p.candidate)).toEqual(['bottom', 'bottom'])
  })

  it('does not let a hidden label reserve collision space', () => {
    const result = layoutPlaceLabels([item('1', 20, 20, 600), item('2', 200, 150, 60)], { x: 0, y: 0, width: 400, height: 300 })
    expect(result.hidden.has('1')).toBe(true)
    expect(result.placements.get('2')?.candidate).toBe('bottom')
  })
})
