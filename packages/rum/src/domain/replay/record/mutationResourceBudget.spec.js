import {
  createMutationResourceBudget,
  MAX_GLOBAL_MUTATION_APPROX_BYTES
} from './mutationResourceBudget'

describe('replay/record/mutationResourceBudget', () => {
  it('should bound aggregate reservations and report one generation failure', () => {
    const budget = createMutationResourceBudget()
    const reservations = []
    let recoveryCount = 0

    for (let rootIndex = 0; rootIndex < 1024; rootIndex += 1) {
      const reservation = budget.reserve('raw', {
        approxBytes: 32769
      })
      if (reservation) {
        reservations.push(reservation)
      } else if (budget.failOnce()) {
        recoveryCount += 1
      }
    }
    if (!budget.reserve('raw', { approxBytes: 32769 })) {
      if (budget.failOnce()) {
        recoveryCount += 1
      }
    }

    expect(budget.getUsage().totalApproxBytes).toBeLessThanOrEqual(
      MAX_GLOBAL_MUTATION_APPROX_BYTES
    )
    expect(recoveryCount).toBe(1)

    reservations.forEach((release) => release())
    budget.reset()
    expect(budget.reserve('raw', { approxBytes: 32769 })).toEqual(
      jasmine.any(Function)
    )
  })
})
