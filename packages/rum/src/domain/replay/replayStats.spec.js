import {
  addRecord,
  addSegment,
  addWroteData,
  deleteOldestStats,
  getReplayStats,
  getSegmentsCount,
  MAX_STATS_HISTORY,
  resetReplayStats
} from './replayStats'

describe('replayStats', () => {
  afterEach(() => {
    resetReplayStats()
  })

  it('should create and update replay stats for a view', () => {
    expect(getReplayStats('view-1')).toBeUndefined()
    expect(getSegmentsCount('view-1')).toBe(0)

    addSegment('view-1')
    addRecord('view-1')
    addWroteData('view-1', 128)

    expect(getReplayStats('view-1')).toEqual({
      records_count: 1,
      segments_count: 1,
      segments_total_raw_size: 128
    })
    expect(getSegmentsCount('view-1')).toBe(1)
  })

  it('should keep only the latest replay stats entries up to the max history', () => {
    for (let index = 0; index <= MAX_STATS_HISTORY; index += 1) {
      addSegment(`view-${index}`)
    }

    expect(getReplayStats('view-0')).toBeUndefined()
    expect(getReplayStats(`view-${MAX_STATS_HISTORY}`)).toEqual(
      jasmine.objectContaining({
        segments_count: 1
      })
    )
  })

  it('should safely handle deleting oldest stats when empty', () => {
    expect(() => {
      deleteOldestStats()
    }).not.toThrow()
  })
})
