import assert from 'node:assert/strict'
import test from 'node:test'
import { cellToBoundary, getResolution, isValidCell } from 'h3-js'
import {
  createDemoForecast,
  getForecast,
  rankForecastZones,
} from '../src/services/forecast.ts'
import type { ForecastHorizon, ForecastMetric } from '../src/types/forecast.ts'

const horizons: ForecastHorizon[] = [0, 30, 60]
const metrics: ForecastMetric[] = ['hourly', 'passengers']

test('demo forecasts contain seven distinct Seoul H3 resolution-8 regions', () => {
  const forecast = createDemoForecast('hourly', 0)
  assert.equal(forecast.zones.length, 7)
  assert.equal(new Set(forecast.zones.map((zone) => zone.id)).size, 7)
  assert.ok(Number.isFinite(Date.parse(forecast.generatedAt)))
  for (const zone of forecast.zones) {
    assert.equal(zone.id, zone.h3Index)
    assert.equal(isValidCell(zone.h3Index), true)
    assert.equal(getResolution(zone.h3Index), 8)
    assert.equal(cellToBoundary(zone.h3Index).length, 6)
    assert.ok(
      zone.lat > 37.45 && zone.lat < 37.55,
      `${zone.name}: latitude is in Seoul fixture area`,
    )
    assert.ok(
      zone.lng > 126.99 && zone.lng < 127.08,
      `${zone.name}: longitude is in Seoul fixture area`,
    )
    assert.ok(zone.reason.length > 0)
  }
})

test('every time point reconciles revenue, costs, and net hourly earnings', () => {
  for (const zone of createDemoForecast('hourly', 0).zones) {
    assert.deepEqual(
      zone.trend.map((point) => point.minutes),
      horizons,
    )
    for (const point of zone.trend) {
      for (const value of [
        point.grossRevenue,
        point.fuelCost,
        point.idleCost,
        point.netHourly,
        point.passengers,
      ]) {
        assert.equal(Number.isFinite(value), true)
        assert.ok(value >= 0)
      }
      assert.equal(point.netHourly, point.grossRevenue - point.fuelCost - point.idleCost)
      assert.ok(Number.isInteger(point.passengers))
    }
  }
})

test('time and metric selection change recommendations using the selected forecast value', () => {
  const { zones } = createDemoForecast('hourly', 0)
  assert.equal(rankForecastZones(zones, 'hourly', 0)[0].name, '강남역')
  assert.equal(rankForecastZones(zones, 'passengers', 0)[0].name, '삼성역')
  assert.equal(rankForecastZones(zones, 'hourly', 30)[0].name, '삼성역')
  assert.equal(rankForecastZones(zones, 'passengers', 60)[0].name, '신논현역')
  for (const metric of metrics) {
    for (const horizon of horizons) {
      const ranked = rankForecastZones(zones, metric, horizon)
      assert.deepEqual(
        ranked.map((zone) => zone.rank),
        [1, 2, 3, 4, 5, 6, 7],
      )
      assert.ok(ranked.every((zone) => zone.current.minutes === horizon))
      const values = ranked.map((zone) =>
        metric === 'hourly' ? zone.current.netHourly : zone.current.passengers,
      )
      assert.deepEqual(
        values,
        values.slice().sort((left, right) => right - left),
      )
    }
  }
})

test('ranking does not mutate source data and resolves ties deterministically', () => {
  const zones = createDemoForecast('hourly', 0).zones
  const before = structuredClone(zones)
  for (const metric of metrics)
    for (const horizon of horizons) rankForecastZones(zones, metric, horizon)
  assert.deepEqual(zones, before)
  const first = zones[0]
  const tied = [
    { ...first, id: 'b' },
    { ...first, id: 'a' },
  ]
  assert.deepEqual(
    rankForecastZones(tied, 'hourly', 0).map((zone) => zone.id),
    ['a', 'b'],
  )
  assert.deepEqual(
    tied.map((zone) => zone.id),
    ['b', 'a'],
  )
})

test('empty or unavailable horizon data never becomes a made-up prediction', () => {
  assert.deepEqual(rankForecastZones([], 'hourly', 0), [])
  const zones = createDemoForecast('hourly', 0).zones
  const missingHorizon = {
    ...zones[0],
    trend: zones[0].trend.filter((point) => point.minutes !== 30),
  }
  assert.deepEqual(rankForecastZones([missingHorizon], 'hourly', 30), [])
  assert.equal(rankForecastZones([missingHorizon], 'hourly', 0).length, 1)
})

test('fixtures are stable across calls and keep all temporal points when filters change', () => {
  const baseline = createDemoForecast('hourly', 0)
  for (const metric of metrics) {
    for (const horizon of horizons) {
      const current = createDemoForecast(metric, horizon)
      assert.equal(current.metric, metric)
      assert.equal(current.horizon, horizon)
      assert.deepEqual(current.zones, baseline.zones)
    }
  }
})

test('forecast API adapter returns validated demo data and honors cancellation', async () => {
  const response = await getForecast('passengers', 60)
  assert.equal(response.metric, 'passengers')
  assert.equal(response.horizon, 60)
  assert.equal(response.zones.length, 7)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(getForecast('hourly', 0, controller.signal), {
    name: 'AbortError',
  })
})
