import { it, expect } from 'vitest'
import { getFakeBMapGl } from '../packages/test-utils'

it('fake bmapgl sanity: map create/destroy + listener accounting', () => {
  const fake = getFakeBMapGl()
  const stats = fake.stats
  stats.reset()

  const host = document.createElement('div')
  const map = new fake.Map(host)
  const listener = () => {}
  map.addEventListener('click', listener)
  expect(stats.listeners).toBe(1)
  map.removeEventListener('click', listener)
  expect(stats.listeners).toBe(0)

  const marker = new fake.Marker(new fake.Point(116.4, 39.9))
  map.addOverlay(marker)
  expect(stats.overlaysCreated).toBe(1)
  map.removeOverlay(marker)
  expect(stats.overlaysRemoved).toBe(1)

  map.destroy()
  expect(stats.mapsDestroyed).toBe(1)
  expect(stats.maps).toBe(0)
})
